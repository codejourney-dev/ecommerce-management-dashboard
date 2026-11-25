
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("../../src/config/prisma.js", () => ({
  prisma: {
    productVariant: {
      findMany,
    },
  },
}));

import {
    validateOrderItems,
    calculateDirectProductDiscount,
    calculateSpecialOfferDiscount,
    getApplicableSpecialOffers,
    getPreviousSpecialOfferCustomerQuantity,
    allocateCouponDiscount,
    calculateCouponDiscount,
    validateCouponForCheckout,
    allocateCouponDiscountToOrderItems,
    calculateOrderPricing,
    type OrderPricingInput,
    type OrderItemInput,
    type SpecialOfferData,
    type OrderItemBeforeCouponInput,
    type CouponData,
} from "../../src/services/order-pricing.service.js";

import { 
    ProductDiscountType,
    SpecialOfferDiscountType,
    OrderStatus,
    CouponType, 
} from "../../generated/prisma/client.js";

const VARIANT_ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const VARIANT_ID_2 = "550e8400-e29b-41d4-a716-446655440002";

const validItems: OrderItemInput[] = [
  {
    variantId: VARIANT_ID_1,
    quantity: 2,
  },
];

const mockVariant = {
  id: VARIANT_ID_1,
  sku: "SKU-001",
  title: "Black / Large",
  priceRial: 1_500_000n,
  product: {
    name: "T-Shirt",
  },
};

const pricingTestNow = new Date("2026-11-25T10:00:00.000Z");

const pricingVariantId = "11111111-1111-4111-8111-111111111111";

function createPricingDb(options?: {
  variants?: any[];
  offers?: any[];
  coupon?: any;
  previousCustomerQuantity?: number;
}) {
  return {
    productVariant: {
      findMany: vi.fn().mockResolvedValue(
        options?.variants ?? [
          {
            id: pricingVariantId,
            sku: "SKU-001",
            title: "Default",
            priceRial: 100_000n,
            discountType: null,
            discountPercent: null,
            discountAmountRial: null,
            discountStartsAt: null,
            discountEndsAt: null,
            isDiscountActive: false,
            product: {
              name: "Test Product",
            },
          },
        ],
      ),
    },

    specialOffer: {
      findMany: vi.fn().mockResolvedValue(options?.offers ?? []),
    },

    orderItem: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: {
          quantity: options?.previousCustomerQuantity ?? 0,
        },
      }),
    },

    coupon: {
      findUnique: vi.fn().mockResolvedValue(options?.coupon ?? null),
    },

    couponRedemption: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

describe("Order Pricing Service - Order Item Validation", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  // Empty Items

  it("rejects an empty order item list", async () => {
    await expect(validateOrderItems([])).rejects.toMatchObject({
      code: "ORDER_ITEMS_REQUIRED",
      statusCode: 400,
    });

    expect(findMany).not.toHaveBeenCalled();
  });

  // Variant ID Validation

  it("rejects an invalid variant ID", async () => {
    const items = [
      {
        variantId: "invalid-id",
        quantity: 1,
      },
    ];

    await expect(validateOrderItems(items)).rejects.toMatchObject({
      code: "INVALID_VARIANT_ID",
      statusCode: 400,
    });

    expect(findMany).not.toHaveBeenCalled();
  });

  // Quantity Validation

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
  ])("rejects an invalid quantity: %s", async (quantity) => {
    const items = [
      {
        variantId: VARIANT_ID_1,
        quantity,
      },
    ];

    await expect(validateOrderItems(items)).rejects.toMatchObject({
      code: "INVALID_ORDER_ITEM_QUANTITY",
      statusCode: 400,
    });

    expect(findMany).not.toHaveBeenCalled();
  });

  it("accepts a valid positive integer quantity", async () => {
    findMany.mockResolvedValue([mockVariant]);

    const result = await validateOrderItems([
      {
        variantId: VARIANT_ID_1,
        quantity: 5,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    expect(result[0]!.quantity).toBe(5);
    expect(findMany).toHaveBeenCalledOnce();
  });

  // Duplicate Variants

  it("rejects duplicate product variant IDs", async () => {
    const items: OrderItemInput[] = [
      {
        variantId: VARIANT_ID_1,
        quantity: 1,
      },
      {
        variantId: VARIANT_ID_1,
        quantity: 3,
      },
    ];

    await expect(validateOrderItems(items)).rejects.toMatchObject({
      code: "DUPLICATE_ORDER_ITEM",
      statusCode: 400,
    });

    expect(findMany).not.toHaveBeenCalled();
  });

  // Database Validation

  it("queries only active variants belonging to active products", async () => {
    findMany.mockResolvedValue([mockVariant]);

    await validateOrderItems(validItems);

    expect(findMany).toHaveBeenCalledWith({
        where: {
            id: {
            in: [VARIANT_ID_1],
            },
            isActive: true,
            product: {
            status: "ACTIVE",
            deletedAt: null,
            },
        },
        select: {
            id: true,
            sku: true,
            title: true,
            priceRial: true,
            discountType: true,
            discountPercent: true,
            discountAmountRial: true,
            discountStartsAt: true,
            discountEndsAt: true,
            isDiscountActive: true,
            product: {
            select: {
                name: true,
            },
            },
        },
    });
  });

  it("rejects a variant that does not exist or is unavailable", async () => {
    findMany.mockResolvedValue([]);

    await expect(validateOrderItems(validItems)).rejects.toMatchObject({
      code: "VARIANT_NOT_AVAILABLE",
      statusCode: 404,
    });
  });

  it("rejects an order if one of its variants is unavailable", async () => {
    findMany.mockResolvedValue([mockVariant]);

    const items: OrderItemInput[] = [
      {
        variantId: VARIANT_ID_1,
        quantity: 1,
      },
      {
        variantId: VARIANT_ID_2,
        quantity: 2,
      },
    ];

    await expect(validateOrderItems(items)).rejects.toMatchObject({
      code: "VARIANT_NOT_AVAILABLE",
      statusCode: 404,
    });
  });

  it("rejects a variant with a negative database price", async () => {
    findMany.mockResolvedValue([
      {
        ...mockVariant,
        priceRial: -100n,
      },
    ]);

    await expect(validateOrderItems(validItems)).rejects.toMatchObject({
      code: "INVALID_PRODUCT_PRICE",
      statusCode: 500,
    });
  });

  // Validated Result

  it("returns normalized order items using database values", async () => {
    findMany.mockResolvedValue([mockVariant]);

    const result = await validateOrderItems(validItems);

    expect(result).toEqual([
      {
        variantId: VARIANT_ID_1,
        productName: "T-Shirt",
        variantTitle: "Black / Large",
        sku: "SKU-001",
        unitPriceRial: 1_500_000n,
        quantity: 2,
      },
    ]);
  });

  it("preserves the original input order", async () => {
    const secondVariant = {
      ...mockVariant,
      id: VARIANT_ID_2,
      sku: "SKU-002",
      title: "White / Medium",
      priceRial: 2_000_000n,
      product: {
        name: "Hoodie",
      },
    };

    // Database returns variants in reverse order.
    findMany.mockResolvedValue([
      secondVariant,
      mockVariant,
    ]);

    const items: OrderItemInput[] = [
      {
        variantId: VARIANT_ID_1,
        quantity: 1,
      },
      {
        variantId: VARIANT_ID_2,
        quantity: 3,
      },
    ];

    const result = await validateOrderItems(items);

    expect(result.map((item) => item.variantId)).toEqual([
      VARIANT_ID_1,
      VARIANT_ID_2,
    ]);

    expect(result.map((item) => item.quantity)).toEqual([1, 3]);
  });
});


describe("Direct Product Discount Calculation", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");

  const baseInput = {
    priceRial: 1_000_000n,
    discountType: ProductDiscountType.PERCENTAGE,
    discountPercent: "20",
    discountAmountRial: null,
    discountStartsAt: null,
    discountEndsAt: null,
    isDiscountActive: true,
    now,
  };

  it("calculates percentage discounts", () => {
    expect(calculateDirectProductDiscount(baseInput)).toEqual({
      originalUnitPriceRial: 1_000_000n,
      discountPerUnitRial: 200_000n,
      finalUnitPriceRial: 800_000n,
      isDiscountApplied: true,
    });
  });

  it("calculates fixed amount discounts", () => {
    expect(
      calculateDirectProductDiscount({
        ...baseInput,
        discountType: ProductDiscountType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: 150_000n,
      }),
    ).toMatchObject({
      discountPerUnitRial: 150_000n,
      finalUnitPriceRial: 850_000n,
      isDiscountApplied: true,
    });
  });

  it("does not apply inactive discounts", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      isDiscountActive: false,
    });

    expect(result.discountPerUnitRial).toBe(0n);
    expect(result.finalUnitPriceRial).toBe(1_000_000n);
  });

  it("does not apply discounts before their start date", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      discountStartsAt: new Date("2026-11-26T00:00:00.000Z"),
    });

    expect(result.isDiscountApplied).toBe(false);
  });

  it("does not apply discounts at or after their end date", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      discountEndsAt: now,
    });

    expect(result.isDiscountApplied).toBe(false);
  });

  it("applies discounts exactly at their start date", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      discountStartsAt: now,
    });

    expect(result.discountPerUnitRial).toBe(200_000n);
  });

  it("caps fixed discounts at the product price", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      discountType: ProductDiscountType.FIXED_AMOUNT,
      discountPercent: null,
      discountAmountRial: 2_000_000n,
    });

    expect(result.discountPerUnitRial).toBe(1_000_000n);
    expect(result.finalUnitPriceRial).toBe(0n);
  });

  it("rejects active discounts without a discount type", () => {
    expect(() =>
      calculateDirectProductDiscount({
        ...baseInput,
        discountType: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      }),
    );
  });

  it("rejects percentage discounts without a percentage value", () => {
    expect(() =>
      calculateDirectProductDiscount({
        ...baseInput,
        discountPercent: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      }),
    );
  });

  it("rejects fixed discounts with a negative amount", () => {
    expect(() =>
      calculateDirectProductDiscount({
        ...baseInput,
        discountType: ProductDiscountType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: -100n,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      }),
    );
  });

  it("rejects conflicting discount values", () => {
    expect(() =>
      calculateDirectProductDiscount({
        ...baseInput,
        discountAmountRial: 100n,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      }),
    );
  });

  it("rejects invalid discount date ranges", () => {
    expect(() =>
      calculateDirectProductDiscount({
        ...baseInput,
        discountStartsAt: new Date("2026-11-27T00:00:00.000Z"),
        discountEndsAt: new Date("2026-11-26T00:00:00.000Z"),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      }),
    );
  });

  it("rejects negative product prices", () => {
    expect(() =>
      calculateDirectProductDiscount({
        ...baseInput,
        priceRial: -1n,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PRODUCT_PRICE",
      }),
    );
  });

  it("returns no discount for a zero-price product", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      priceRial: 0n,
    });

    expect(result.discountPerUnitRial).toBe(0n);
    expect(result.finalUnitPriceRial).toBe(0n);
    expect(result.isDiscountApplied).toBe(false);
  });

  it("uses FLOOR rounding for percentage discounts", () => {
    const result = calculateDirectProductDiscount({
      ...baseInput,
      priceRial: 101n,
      discountPercent: "10",
    });

    expect(result.discountPerUnitRial).toBe(10n);
    expect(result.finalUnitPriceRial).toBe(91n);
  });
});


describe("Special Offer Validation & Calculation", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");

  const offer: SpecialOfferData = {
    id: "offer-1",
    variantId: "variant-1",
    discountType: SpecialOfferDiscountType.PERCENTAGE,
    discountPercent: "20",
    discountAmountRial: null,
    maxQuantityPerOrder: 5,
    maxQuantityPerCustomer: 10,
    startsAt: new Date("2026-11-20T00:00:00.000Z"),
    endsAt: new Date("2026-11-30T00:00:00.000Z"),
    isActive: true,
  };

  it("calculates percentage Special Offer discount", () => {
    const result = calculateSpecialOfferDiscount({
      priceRial: 100_000n,
      quantity: 2,
      offer,
      now,
    });

    expect(result.discountPerUnitRial).toBe(20_000n);
    expect(result.finalUnitPriceRial).toBe(80_000n);
    expect(result.rowDiscountAmountRial).toBe(40_000n);
    expect(result.finalRowTotalRial).toBe(160_000n);
    expect(result.couponEligible).toBe(false);
  });

  it("calculates fixed Special Offer discount", () => {
    const result = calculateSpecialOfferDiscount({
      priceRial: 100_000n,
      quantity: 2,
      offer: {
        ...offer,
        discountType: SpecialOfferDiscountType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: 15_000n,
      },
      now,
    });

    expect(result.discountPerUnitRial).toBe(15_000n);
    expect(result.rowDiscountAmountRial).toBe(30_000n);
    expect(result.finalRowTotalRial).toBe(170_000n);
  });

  it("caps fixed discount at the unit price", () => {
    const result = calculateSpecialOfferDiscount({
      priceRial: 10_000n,
      quantity: 1,
      offer: {
        ...offer,
        discountType: SpecialOfferDiscountType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: 20_000n,
      },
      now,
    });

    expect(result.discountPerUnitRial).toBe(10_000n);
    expect(result.finalUnitPriceRial).toBe(0n);
  });

  it("uses FLOOR for percentage discounts", () => {
    const result = calculateSpecialOfferDiscount({
      priceRial: 99n,
      quantity: 1,
      offer: {
        ...offer,
        discountPercent: "15",
      },
      now,
    });

    expect(result.discountPerUnitRial).toBe(14n);
    expect(result.finalUnitPriceRial).toBe(85n);
  });

  it("rejects quantities above the per-order limit", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 6,
        offer,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SPECIAL_OFFER_ORDER_LIMIT_EXCEEDED",
      }),
    );
  });

  it("rejects quantities above the per-customer limit", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 2,
        previousCustomerQuantity: 9,
        offer,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SPECIAL_OFFER_CUSTOMER_LIMIT_EXCEEDED",
      }),
    );
  });

  it("allows a customer to purchase up to the exact customer limit", () => {
    const result = calculateSpecialOfferDiscount({
      priceRial: 100_000n,
      quantity: 2,
      previousCustomerQuantity: 8,
      offer,
      now,
    });

    expect(result.quantity).toBe(2);
  });

  it("rejects inactive offers", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 1,
        offer: { ...offer, isActive: false },
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SPECIAL_OFFER_NOT_AVAILABLE",
      }),
    );
  });

  it("rejects offers before their start date", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 1,
        offer,
        now: new Date("2026-11-19T23:59:59.000Z"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SPECIAL_OFFER_NOT_AVAILABLE",
      }),
    );
  });

  it("rejects offers at their exclusive end date", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 1,
        offer,
        now: offer.endsAt,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "SPECIAL_OFFER_NOT_AVAILABLE",
      }),
    );
  });

  it("rejects invalid discount configuration", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 1,
        offer: {
          ...offer,
          discountPercent: null,
        },
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_SPECIAL_OFFER_CONFIGURATION",
      }),
    );
  });

  it("rejects negative product prices", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: -1n,
        quantity: 1,
        offer,
        now,
      }),
    ).toThrow();
  });

  it("rejects zero quantity", () => {
    expect(() =>
      calculateSpecialOfferDiscount({
        priceRial: 100_000n,
        quantity: 0,
        offer,
        now,
      }),
    ).toThrow();
  });

  it("rejects multiple valid offers for the same variant", async () => {
    const db = {
      specialOffer: {
        findMany: vi.fn().mockResolvedValue([
          offer,
          { ...offer, id: "offer-2" },
        ]),
      },
    } as never;

    await expect(
      getApplicableSpecialOffers(["variant-1"], now, db),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "INVALID_SPECIAL_OFFER_CONFIGURATION",
      }),
    );
  });

  it("returns an empty map when no valid offers exist", async () => {
    const db = {
      specialOffer: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as never;

    const result = await getApplicableSpecialOffers(
      ["variant-1"],
      now,
      db,
    );

    expect(result.size).toBe(0);
  });

  it("retrieves previous customer quantity", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _sum: { quantity: 4 },
    });

    const db = {
      orderItem: { aggregate },
    } as never;

    const result = await getPreviousSpecialOfferCustomerQuantity(
      "offer-1",
      "customer-1",
      db,
    );

    expect(result).toBe(4);
    expect(aggregate).toHaveBeenCalledWith({
        where: {
            specialOfferId: "offer-1",
            orders: {
            is: {
                customerId: "customer-1",
                status: { not: OrderStatus.CANCELLED },
            },
            },
        },
        _sum: {
            quantity: true,
        },
    });
  });

  it("returns zero when the customer has no previous purchases", async () => {
    const db = {
      orderItem: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { quantity: null },
        }),
      },
    } as never;

    const result = await getPreviousSpecialOfferCustomerQuantity(
      "offer-1",
      "customer-1",
      db,
    );

    expect(result).toBe(0);
  });
});


describe("Coupon Validation & Calculation", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");

  const coupon: CouponData = {
    id: "coupon-1",
    code: "SAVE20",
    discountType: CouponType.PERCENTAGE,
    discountPercent: "20",
    discountAmountRial: null,
    minimumEligibleAmountRial: 50_000n,
    maximumDiscountRial: null,
    usageLimit: null,
    usagePerCustomer: 1,
    isActive: true,
    startsAt: new Date("2026-11-20T00:00:00.000Z"),
    expiresAt: new Date("2026-11-30T00:00:00.000Z"),
  };

  it("calculates percentage coupon discounts", () => {
    const result = calculateCouponDiscount({
      coupon,
      eligibleSubtotalRial: 100_000n,
      now,
    });

    expect(result.discountAmountRial).toBe(20_000n);
    expect(result.eligibleSubtotalRial).toBe(100_000n);
    expect(result.couponCode).toBe("SAVE20");
  });

  it("calculates fixed coupon discounts", () => {
    const result = calculateCouponDiscount({
      coupon: {
        ...coupon,
        discountType: CouponType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: 30_000n,
      },
      eligibleSubtotalRial: 100_000n,
      now,
    });

    expect(result.discountAmountRial).toBe(30_000n);
  });

  it("caps percentage discounts at maximumDiscountRial", () => {
    const result = calculateCouponDiscount({
      coupon: {
        ...coupon,
        maximumDiscountRial: 10_000n,
      },
      eligibleSubtotalRial: 100_000n,
      now,
    });

    expect(result.discountAmountRial).toBe(10_000n);
  });

  it("caps fixed discounts at maximumDiscountRial", () => {
    const result = calculateCouponDiscount({
      coupon: {
        ...coupon,
        discountType: CouponType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: 40_000n,
        maximumDiscountRial: 15_000n,
      },
      eligibleSubtotalRial: 100_000n,
      now,
    });

    expect(result.discountAmountRial).toBe(15_000n);
  });

  it("does not discount more than eligible subtotal", () => {
    const result = calculateCouponDiscount({
      coupon: {
        ...coupon,
        discountType: CouponType.FIXED_AMOUNT,
        discountPercent: null,
        discountAmountRial: 200_000n,
      },
      eligibleSubtotalRial: 100_000n,
      now,
    });

    expect(result.discountAmountRial).toBe(100_000n);
  });

  it("rejects subtotal below the minimum eligible amount", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon,
        eligibleSubtotalRial: 49_999n,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "COUPON_MINIMUM_NOT_MET",
      }),
    );
  });

  it("accepts subtotal equal to the minimum eligible amount", () => {
    const result = calculateCouponDiscount({
      coupon,
      eligibleSubtotalRial: 50_000n,
      now,
    });

    expect(result.discountAmountRial).toBe(10_000n);
  });

  it("rejects inactive coupons", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon: { ...coupon, isActive: false },
        eligibleSubtotalRial: 100_000n,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "COUPON_NOT_AVAILABLE",
      }),
    );
  });

  it("rejects coupons before their start date", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon,
        eligibleSubtotalRial: 100_000n,
        now: new Date("2026-11-19T23:59:59.000Z"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "COUPON_NOT_AVAILABLE",
      }),
    );
  });

  it("rejects coupons at their exclusive expiration date", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon,
        eligibleSubtotalRial: 100_000n,
        now: coupon.expiresAt,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "COUPON_NOT_AVAILABLE",
      }),
    );
  });

  it("rejects invalid percentage configuration", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon: {
          ...coupon,
          discountPercent: null,
        },
        eligibleSubtotalRial: 100_000n,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_COUPON_CONFIGURATION",
      }),
    );
  });

  it("rejects invalid fixed discount configuration", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon: {
          ...coupon,
          discountType: CouponType.FIXED_AMOUNT,
          discountPercent: null,
          discountAmountRial: -1n,
        },
        eligibleSubtotalRial: 100_000n,
        now,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_COUPON_CONFIGURATION",
      }),
    );
  });

  it("uses FLOOR rounding for percentage coupons", () => {
    const result = calculateCouponDiscount({
      coupon: {
        ...coupon,
        discountPercent: "15",
        minimumEligibleAmountRial: 0n,
      },
      eligibleSubtotalRial: 99n,
      now,
    });

    expect(result.discountAmountRial).toBe(14n);
  });

  it("rejects negative eligible subtotal", () => {
    expect(() =>
      calculateCouponDiscount({
        coupon,
        eligibleSubtotalRial: -1n,
        now,
      }),
    ).toThrow();
  });

  it("allocates coupon discount proportionally", () => {
    const result = allocateCouponDiscount({
      items: [
        {
          variantId: "variant-1",
          subtotalAfterItemDiscountRial: 60_000n,
          specialOfferId: null,
        },
        {
          variantId: "variant-2",
          subtotalAfterItemDiscountRial: 40_000n,
          specialOfferId: null,
        },
      ],
      couponDiscountAmountRial: 10_000n,
    });

    expect(result[0]?.couponDiscountAmountRial).toBe(6_000n);
    expect(result[1]?.couponDiscountAmountRial).toBe(4_000n);

    expect(
      result.reduce(
        (sum, item) => sum + item.couponDiscountAmountRial,
        0n,
      ),
    ).toBe(10_000n);
  });

  it("distributes remainder Rial deterministically in input order", () => {
    const result = allocateCouponDiscount({
      items: [
        {
          variantId: "variant-1",
          subtotalAfterItemDiscountRial: 100n,
          specialOfferId: null,
        },
        {
          variantId: "variant-2",
          subtotalAfterItemDiscountRial: 100n,
          specialOfferId: null,
        },
        {
          variantId: "variant-3",
          subtotalAfterItemDiscountRial: 100n,
          specialOfferId: null,
        },
      ],
      couponDiscountAmountRial: 2n,
    });

    expect(result.map((item) => item.couponDiscountAmountRial)).toEqual([
      1n,
      1n,
      0n,
    ]);
  });

  it("excludes Special Offer items from coupon allocation", () => {
    const result = allocateCouponDiscount({
      items: [
        {
          variantId: "variant-1",
          subtotalAfterItemDiscountRial: 60_000n,
          specialOfferId: null,
        },
        {
          variantId: "variant-2",
          subtotalAfterItemDiscountRial: 40_000n,
          specialOfferId: "offer-1",
        },
      ],
      couponDiscountAmountRial: 6_000n,
    });

    expect(result[0]?.couponDiscountAmountRial).toBe(6_000n);
    expect(result[1]?.couponDiscountAmountRial).toBe(0n);
    expect(result[1]?.couponEligible).toBe(false);
    expect(result[1]?.finalTotalRial).toBe(40_000n);
  });

  it("preserves regular product discounts in coupon eligibility", () => {
    const result = allocateCouponDiscount({
      items: [
        {
          variantId: "variant-1",
          subtotalAfterItemDiscountRial: 80_000n,
          specialOfferId: null,
        },
      ],
      couponDiscountAmountRial: 8_000n,
    });

    expect(result[0]?.couponEligible).toBe(true);
    expect(result[0]?.finalTotalRial).toBe(72_000n);
  });

  it("rejects coupon discount greater than eligible subtotal", () => {
    expect(() =>
      allocateCouponDiscount({
        items: [
          {
            variantId: "variant-1",
            subtotalAfterItemDiscountRial: 10_000n,
            specialOfferId: null,
          },
        ],
        couponDiscountAmountRial: 10_001n,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_COUPON_DISCOUNT_AMOUNT",
      }),
    );
  });

  it("rejects duplicate variant IDs during allocation", () => {
    expect(() =>
      allocateCouponDiscount({
        items: [
          {
            variantId: "variant-1",
            subtotalAfterItemDiscountRial: 10_000n,
            specialOfferId: null,
          },
          {
            variantId: "variant-1",
            subtotalAfterItemDiscountRial: 20_000n,
            specialOfferId: null,
          },
        ],
        couponDiscountAmountRial: 1_000n,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DUPLICATE_ORDER_ITEM",
      }),
    );
  });

  it("returns zero allocations when coupon discount is zero", () => {
    const result = allocateCouponDiscount({
      items: [
        {
          variantId: "variant-1",
          subtotalAfterItemDiscountRial: 10_000n,
          specialOfferId: null,
        },
      ],
      couponDiscountAmountRial: 0n,
    });

    expect(result[0]?.couponDiscountAmountRial).toBe(0n);
    expect(result[0]?.finalTotalRial).toBe(10_000n);
  });

  it("rejects an empty coupon code", async () => {
    await expect(
      validateCouponForCheckout({
        code: "   ",
        eligibleSubtotalRial: 100_000n,
        now,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "COUPON_CODE_REQUIRED",
      }),
    );
  });

  it("rejects a coupon that does not exist", async () => {
    const db = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(
      validateCouponForCheckout(
        {
          code: "UNKNOWN",
          eligibleSubtotalRial: 100_000n,
          now,
        },
        db as never,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "COUPON_NOT_FOUND",
      }),
    );
  });

  it("checks global usage limit", async () => {
    const db = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue({
            ...coupon,
            usageLimit: 5,
        }),
    },
      couponRedemption: {
        count: vi.fn().mockResolvedValue(5),
      },
    };

    await expect(
      validateCouponForCheckout(
        {
          code: "SAVE20",
          eligibleSubtotalRial: 100_000n,
          now,
        },
        db as never,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "COUPON_USAGE_LIMIT_REACHED",
      }),
    );
  });

  it("checks customer usage limit", async () => {
    const db = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue(coupon),
      },
      couponRedemption: {
        count: vi.fn().mockResolvedValue(1),
      },
    };

    await expect(
      validateCouponForCheckout(
        {
          code: "SAVE20",
          customerId: "customer-1",
          eligibleSubtotalRial: 100_000n,
          now,
        },
        db as never,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "COUPON_CUSTOMER_USAGE_LIMIT_REACHED",
      }),
    );
  });

  it("does not apply per-customer limits to anonymous customers", async () => {
    const count = vi.fn();

    const db = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue(coupon),
      },
      couponRedemption: { count },
    };

    const result = await validateCouponForCheckout(
      {
        code: "SAVE20",
        customerId: null,
        eligibleSubtotalRial: 100_000n,
        now,
      },
      db as never,
    );

    expect(result.discount.discountAmountRial).toBe(20_000n);
    expect(count).not.toHaveBeenCalled();
  });

  it("allows unlimited global usage when usageLimit is null", async () => {
    const count = vi.fn();

    const db = {
      coupon: {
        findUnique: vi.fn().mockResolvedValue({
          ...coupon,
          usageLimit: null,
          usagePerCustomer: 0,
        }),
      },
      couponRedemption: { count },
    };

    const result = await validateCouponForCheckout(
      {
        code: "SAVE20",
        eligibleSubtotalRial: 100_000n,
        now,
      },
      db as never,
    );

    expect(result.discount.discountAmountRial).toBe(20_000n);
    expect(count).not.toHaveBeenCalled();
  });
});


describe("Coupon Discount Allocation - Order Integration", () => {
  const baseItems: OrderItemBeforeCouponInput[] = [
    {
      variantId: "variant-a",
      productName: "Product A",
      variantTitle: "Default",
      sku: "SKU-A",
      unitPriceRial: 100_000n,
      quantity: 2,
      discountAmountRial: 20_000n,
      specialOfferId: null,
    },
    {
      variantId: "variant-b",
      productName: "Product B",
      variantTitle: "Default",
      sku: "SKU-B",
      unitPriceRial: 200_000n,
      quantity: 1,
      discountAmountRial: 50_000n,
      specialOfferId: "offer-1",
    },
  ];

  it("calculates original order subtotal", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.subtotalRial).toBe(400_000n);
  });

  it("calculates total item discounts", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.itemDiscountTotalRial).toBe(70_000n);
  });

  it("excludes Special Offer items from eligible subtotal", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.eligibleSubtotalRial).toBe(180_000n);
  });

  it("allocates coupon discount to eligible items only", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.items[0]?.couponDiscountAmountRial).toBe(18_000n);
    expect(result.items[1]?.couponDiscountAmountRial).toBe(0n);
  });

  it("calculates final item totals correctly", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.items[0]?.totalPriceRial).toBe(162_000n);
    expect(result.items[1]?.totalPriceRial).toBe(150_000n);
  });

  it("calculates total discount correctly", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.discountTotalRial).toBe(88_000n);
    expect(result.itemsTotalAfterDiscountRial).toBe(312_000n);
  });

  it("rejects item discounts greater than row subtotal", () => {
    expect(() =>
      allocateCouponDiscountToOrderItems({
        items: [
          {
            ...baseItems[0]!,
            discountAmountRial: 300_000n,
          },
        ],
        couponDiscountAmountRial: 0n,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_ITEM_DISCOUNT_AMOUNT",
      }),
    );
  });

  it("rejects coupon discounts greater than eligible subtotal", () => {
    expect(() =>
      allocateCouponDiscountToOrderItems({
        items: baseItems,
        couponDiscountAmountRial: 200_000n,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_COUPON_DISCOUNT_AMOUNT",
      }),
    );
  });

  it("rejects an empty order", () => {
    expect(() =>
      allocateCouponDiscountToOrderItems({
        items: [],
        couponDiscountAmountRial: 0n,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ORDER_ITEMS_REQUIRED",
      }),
    );
  });

  it("preserves the original item order", () => {
    const result = allocateCouponDiscountToOrderItems({
      items: baseItems,
      couponDiscountAmountRial: 18_000n,
    });

    expect(result.items.map((item) => item.variantId)).toEqual([
      "variant-a",
      "variant-b",
    ]);
  });
});

describe("Order Pricing Integration", () => {
  it("calculates order pricing with regular product discount", async () => {
    const db = createPricingDb({
      variants: [
        {
          id: pricingVariantId,
          sku: "SKU-001",
          title: "Default",
          priceRial: 100_000n,
          discountType: ProductDiscountType.PERCENTAGE,
          discountPercent: "10",
          discountAmountRial: null,
          discountStartsAt: null,
          discountEndsAt: null,
          isDiscountActive: true,
          product: { name: "Test Product" },
        },
      ],
    });

    const result = await calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 2 }],
        now: pricingTestNow,
      },
      db as never,
    );

    expect(result.subtotalRial).toBe(200_000n);
    expect(result.itemDiscountTotalRial).toBe(20_000n);
    expect(result.couponDiscountRial).toBe(0n);
    expect(result.grandTotalRial).toBe(180_000n);
  });

  it("prioritizes Special Offer over direct product discount", async () => {
    const db = createPricingDb({
      variants: [
        {
          id: pricingVariantId,
          sku: "SKU-001",
          title: "Default",
          priceRial: 100_000n,
          discountType: ProductDiscountType.PERCENTAGE,
          discountPercent: "10",
          discountAmountRial: null,
          discountStartsAt: null,
          discountEndsAt: null,
          isDiscountActive: true,
          product: { name: "Test Product" },
        },
      ],
      offers: [
        {
          id: "offer-1",
          variantId: pricingVariantId,
          discountType: SpecialOfferDiscountType.PERCENTAGE,
          discountPercent: "20",
          discountAmountRial: null,
          maxQuantityPerOrder: 5,
          maxQuantityPerCustomer: 10,
          startsAt: new Date("2026-11-20T00:00:00.000Z"),
          endsAt: new Date("2026-11-30T00:00:00.000Z"),
          isActive: true,
        },
      ],
    });

    const result = await calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 2 }],
        now: pricingTestNow,
      },
      db as never,
    );

    expect(result.itemDiscountTotalRial).toBe(40_000n);
    expect(result.items[0]?.specialOfferId).toBe("offer-1");
    expect(result.items[0]?.discountAmountRial).toBe(40_000n);
    expect(result.grandTotalRial).toBe(160_000n);
  });

  it("applies coupon after regular product discounts", async () => {
    const db = createPricingDb({
      variants: [
        {
          id: pricingVariantId,
          sku: "SKU-001",
          title: "Default",
          priceRial: 100_000n,
          discountType: ProductDiscountType.PERCENTAGE,
          discountPercent: "10",
          discountAmountRial: null,
          discountStartsAt: null,
          discountEndsAt: null,
          isDiscountActive: true,
          product: { name: "Test Product" },
        },
      ],
      coupon: {
        id: "coupon-1",
        code: "SAVE10",
        discountType: CouponType.PERCENTAGE,
        discountPercent: "10",
        discountAmountRial: null,
        minimumEligibleAmountRial: 0n,
        maximumDiscountRial: null,
        usageLimit: null,
        usagePerCustomer: 0,
        isActive: true,
        startsAt: new Date("2026-11-20T00:00:00.000Z"),
        expiresAt: new Date("2026-11-30T00:00:00.000Z"),
      },
    });

    const result = await calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 1 }],
        couponCode: "SAVE10",
        now: pricingTestNow,
      },
      db as never,
    );

    expect(result.subtotalRial).toBe(100_000n);
    expect(result.itemDiscountTotalRial).toBe(10_000n);
    expect(result.couponDiscountRial).toBe(9_000n);
    expect(result.discountTotalRial).toBe(19_000n);
    expect(result.grandTotalRial).toBe(81_000n);
    expect(result.coupon?.couponCode).toBe("SAVE10");
  });

  it("includes shipping and tax in grand total", async () => {
    const db = createPricingDb();

    const result = await calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 1 }],
        shippingCostRial: 15_000n,
        taxTotalRial: 10_000n,
        now: pricingTestNow,
      },
      db as never,
    );

    expect(result.subtotalRial).toBe(100_000n);
    expect(result.grandTotalRial).toBe(125_000n);
  });

  it("does not apply coupon discount to Special Offer items", async () => {
    const db = createPricingDb({
      offers: [
        {
          id: "offer-1",
          variantId: pricingVariantId,
          discountType: SpecialOfferDiscountType.PERCENTAGE,
          discountPercent: "20",
          discountAmountRial: null,
          maxQuantityPerOrder: 5,
          maxQuantityPerCustomer: 10,
          startsAt: new Date("2026-11-20T00:00:00.000Z"),
          endsAt: new Date("2026-11-30T00:00:00.000Z"),
          isActive: true,
        },
      ],
      coupon: {
        id: "coupon-1",
        code: "SAVE10",
        discountType: CouponType.PERCENTAGE,
        discountPercent: "10",
        discountAmountRial: null,
        minimumEligibleAmountRial: 0n,
        maximumDiscountRial: null,
        usageLimit: null,
        usagePerCustomer: 0,
        isActive: true,
        startsAt: new Date("2026-11-20T00:00:00.000Z"),
        expiresAt: new Date("2026-11-30T00:00:00.000Z"),
      },
    });

    const result = await calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 1 }],
        couponCode: "SAVE10",
        now: pricingTestNow,
      },
      db as never,
    );

    expect(result.itemDiscountTotalRial).toBe(20_000n);
    expect(result.couponDiscountRial).toBe(0n);
    expect(result.items[0]?.couponDiscountAmountRial).toBe(0n);
    expect(result.grandTotalRial).toBe(80_000n);
  });

  it("rejects negative shipping cost", async () => {
  const db = createPricingDb();

  await expect(
    calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 1 }],
        shippingCostRial: -1n,
        now: pricingTestNow,
      },
      db as never,
    ),
  ).rejects.toThrow("shippingCostRial cannot be negative.");
});

  it("rejects negative tax amount", async () => {
    const db = createPricingDb();

    await expect(
      calculateOrderPricing(
        {
          items: [{ variantId: pricingVariantId, quantity: 1 }],
          taxTotalRial: -1n,
          now: pricingTestNow,
        },
        db as never,
      ),
    ).rejects.toThrowError();
  });

  it("returns null coupon when no coupon code is provided", async () => {
    const db = createPricingDb();

    const result = await calculateOrderPricing(
      {
        items: [{ variantId: pricingVariantId, quantity: 1 }],
        now: pricingTestNow,
      },
      db as never,
    );

    expect(result.coupon).toBeNull();
    expect(db.coupon.findUnique).not.toHaveBeenCalled();
  });
});

