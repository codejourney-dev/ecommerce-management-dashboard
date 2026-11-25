// Imports
import { prisma } from "../config/prisma.js";
import {
    Prisma,
    CouponType,
    OrderStatus,
    ProductDiscountType,
    SpecialOfferDiscountType,
} from "../../generated/prisma/client.js";
import {
    assertNonNegativeRial,
    calculateFixedDiscountRial,
    calculatePercentageDiscountRial,
    percentageToBasisPoints,
    type PercentageInput,
} from "../utils/money.js";

// Types & Interfaceses
type DbClient = typeof prisma | Prisma.TransactionClient;

export interface OrderItemInput {
  variantId: string;
  quantity: number;
}

export interface ValidatedOrderItem {
  variantId: string;
  productName: string;
  variantTitle: string;
  sku: string;
  unitPriceRial: bigint;
  quantity: number;

  discountType: ProductDiscountType | null;
  discountPercent: PercentageInput | null;
  discountAmountRial: bigint | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
  isDiscountActive: boolean;
}

export interface CouponData {
  id: string;
  code: string;
  discountType: CouponType;
  discountPercent: PercentageInput | null;
  discountAmountRial: bigint | null;
  minimumEligibleAmountRial: bigint;
  maximumDiscountRial: bigint | null;
  usageLimit: number | null;
  usagePerCustomer: number;
  isActive: boolean;
  startsAt: Date;
  expiresAt: Date;
}

export interface CouponEligibleItemInput {
  variantId: string;
  subtotalAfterItemDiscountRial: bigint;
  specialOfferId: string | null;
}

export interface CouponDiscountResult {
  couponId: string;
  couponCode: string;
  eligibleSubtotalRial: bigint;
  discountAmountRial: bigint;
}

export interface CouponItemAllocation {
  variantId: string;
  subtotalAfterItemDiscountRial: bigint;
  couponDiscountAmountRial: bigint;
  finalTotalRial: bigint;
  couponEligible: boolean;
}

export interface DirectProductDiscountResult {
  originalUnitPriceRial: bigint;
  discountPerUnitRial: bigint;
  finalUnitPriceRial: bigint;
  isDiscountApplied: boolean;
}

interface DirectProductDiscountInput {
  priceRial: bigint;
  discountType: ProductDiscountType | null;
  discountPercent: PercentageInput | null;
  discountAmountRial: bigint | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
  isDiscountActive: boolean;
  now?: Date;
}

export interface OrderItemBeforeCouponInput {
  variantId: string;
  productName: string;
  variantTitle: string;
  sku: string;
  unitPriceRial: bigint;
  quantity: number;

  // Total row discount, not per-unit discount.
  discountAmountRial: bigint;

  // null means this item is not part of a Special Offer.
  specialOfferId: string | null;
}

export interface OrderItemWithCouponAllocation {
  variantId: string;
  productName: string;
  variantTitle: string;
  sku: string;
  unitPriceRial: bigint;
  quantity: number;
  discountAmountRial: bigint;
  couponDiscountAmountRial: bigint;
  specialOfferId: string | null;
  totalPriceRial: bigint;
}

export interface CouponAllocationForOrderResult {
  items: OrderItemWithCouponAllocation[];

  subtotalRial: bigint;
  itemDiscountTotalRial: bigint;
  eligibleSubtotalRial: bigint;
  couponDiscountRial: bigint;
  discountTotalRial: bigint;
  itemsTotalAfterDiscountRial: bigint;
}

export interface SpecialOfferData {
  id: string;
  variantId: string;
  discountType: SpecialOfferDiscountType;
  discountPercent: PercentageInput | null;
  discountAmountRial: bigint | null;
  maxQuantityPerOrder: number;
  maxQuantityPerCustomer: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

export interface SpecialOfferDiscountResult {
  specialOfferId: string;
  originalUnitPriceRial: bigint;
  discountPerUnitRial: bigint;
  finalUnitPriceRial: bigint;
  quantity: number;
  rowDiscountAmountRial: bigint;
  finalRowTotalRial: bigint;
  couponEligible: false;
}

export interface OrderPricingInput {
  items: OrderItemInput[];
  customerId?: string | null;
  couponCode?: string | null;
  shippingCostRial?: bigint;
  taxTotalRial?: bigint;
  now?: Date;
}

export interface OrderPricingResult {
  items: OrderItemWithCouponAllocation[];

  subtotalRial: bigint;
  itemDiscountTotalRial: bigint;
  couponDiscountRial: bigint;
  discountTotalRial: bigint;

  shippingCostRial: bigint;
  taxTotalRial: bigint;
  grandTotalRial: bigint;

  coupon: CouponDiscountResult | null;
}
// Errors
export class OrderPricingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "OrderPricingError";
  }
}
// Validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_ORDER_ITEM_QUANTITY = 2_147_483_647;

function validateOrderItemInputs(
  items: OrderItemInput[],
): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderPricingError(
      "An order must contain at least one item.",
      "ORDER_ITEMS_REQUIRED",
    );
  }

  const seenVariantIds = new Set<string>();

  for (const item of items) {
    if (
      !item ||
      typeof item.variantId !== "string" ||
      !UUID_REGEX.test(item.variantId)
    ) {
      throw new OrderPricingError(
        "Invalid product variant ID.",
        "INVALID_VARIANT_ID",
      );
    }

    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_ORDER_ITEM_QUANTITY
    ) {
      throw new OrderPricingError(
        "Order item quantity must be a positive integer.",
        "INVALID_ORDER_ITEM_QUANTITY",
      );
    }

    if (seenVariantIds.has(item.variantId)) {
      throw new OrderPricingError(
        "Duplicate product variants are not allowed.",
        "DUPLICATE_ORDER_ITEM",
      );
    }

    seenVariantIds.add(item.variantId);
  }
}

export function calculateDirectProductDiscount(
  input: DirectProductDiscountInput,
): DirectProductDiscountResult {
  const {
    priceRial,
    discountType,
    discountPercent,
    discountAmountRial,
    discountStartsAt,
    discountEndsAt,
    isDiscountActive,
    now = new Date(),
  } = input;

  if (priceRial < 0n) {
    throw new OrderPricingError(
      "Product price cannot be negative.",
      "INVALID_PRODUCT_PRICE",
      500,
    );
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new OrderPricingError(
      "Invalid discount evaluation date.",
      "INVALID_DISCOUNT_EVALUATION_DATE",
      500,
    );
  }

  if (
    (discountStartsAt !== null &&
      (!(discountStartsAt instanceof Date) ||
        Number.isNaN(discountStartsAt.getTime()))) ||
    (discountEndsAt !== null &&
      (!(discountEndsAt instanceof Date) ||
        Number.isNaN(discountEndsAt.getTime())))
  ) {
    throw new OrderPricingError(
      "Invalid product discount date configuration.",
      "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      500,
    );
  }

  if (
    discountStartsAt !== null &&
    discountEndsAt !== null &&
    discountStartsAt.getTime() >= discountEndsAt.getTime()
  ) {
    throw new OrderPricingError(
      "Product discount start date must be before its end date.",
      "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      500,
    );
  }

  const noDiscount = (): DirectProductDiscountResult => ({
    originalUnitPriceRial: priceRial,
    discountPerUnitRial: 0n,
    finalUnitPriceRial: priceRial,
    isDiscountApplied: false,
  });

  if (!isDiscountActive) {
    return noDiscount();
  }

  if (
    (discountStartsAt !== null &&
      now.getTime() < discountStartsAt.getTime()) ||
    (discountEndsAt !== null &&
      now.getTime() >= discountEndsAt.getTime())
  ) {
    return noDiscount();
  }

  if (discountType === null) {
    throw new OrderPricingError(
      "Active product discount has no discount type.",
      "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
      500,
    );
  }

  let discountPerUnitRial: bigint;

  switch (discountType) {
    case ProductDiscountType.PERCENTAGE: {
      if (
        discountPercent === null ||
        discountAmountRial !== null
      ) {
        throw new OrderPricingError(
          "Invalid percentage discount configuration.",
          "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
          500,
        );
      }

      try {
        discountPerUnitRial = calculatePercentageDiscountRial(
          priceRial,
          discountPercent,
        );
      } catch {
        throw new OrderPricingError(
          "Invalid percentage discount configuration.",
          "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
          500,
        );
      }

      break;
    }

    case ProductDiscountType.FIXED_AMOUNT: {
      if (
        discountAmountRial === null ||
        discountPercent !== null ||
        discountAmountRial < 0n
      ) {
        throw new OrderPricingError(
          "Invalid fixed discount configuration.",
          "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
          500,
        );
      }

      discountPerUnitRial = calculateFixedDiscountRial(
        priceRial,
        discountAmountRial,
      );

      break;
    }

    default: {
      throw new OrderPricingError(
        "Unsupported product discount type.",
        "INVALID_PRODUCT_DISCOUNT_CONFIGURATION",
        500,
      );
    }
  }

  return {
    originalUnitPriceRial: priceRial,
    discountPerUnitRial,
    finalUnitPriceRial: priceRial - discountPerUnitRial,
    isDiscountApplied: discountPerUnitRial > 0n,
  };
}
// Order Item Validation
export async function validateOrderItems(
  items: OrderItemInput[],
  db: DbClient = prisma,
): Promise<ValidatedOrderItem[]> {
  validateOrderItemInputs(items);

  const variantIds = items.map((item) => item.variantId);

  const variants = await db.productVariant.findMany({
    where: {
      id: {
        in: variantIds,
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

  const variantsById = new Map(
    variants.map((variant) => [variant.id, variant]),
  );

  return items.map((item) => {
    const variant = variantsById.get(item.variantId);

    if (!variant) {
      throw new OrderPricingError(
        "Product variant does not exist or is not available.",
        "VARIANT_NOT_AVAILABLE",
        404,
      );
    }

    if (variant.priceRial < 0n) {
      throw new OrderPricingError(
        "Product variant has an invalid price.",
        "INVALID_PRODUCT_PRICE",
        500,
      );
    }

    return {
        variantId: variant.id,
        productName: variant.product.name,
        variantTitle: variant.title,
        sku: variant.sku,
        unitPriceRial: variant.priceRial,
        quantity: item.quantity,

        discountType: variant.discountType,
        discountPercent: variant.discountPercent,
        discountAmountRial: variant.discountAmountRial,
        discountStartsAt: variant.discountStartsAt,
        discountEndsAt: variant.discountEndsAt,
        isDiscountActive: variant.isDiscountActive,
    };
  });
}

function invalidSpecialOffer(message: string): never {
  throw new OrderPricingError(
    message,
    "INVALID_SPECIAL_OFFER_CONFIGURATION",
    500,
  );
}

function validateSpecialOfferConfiguration(
  offer: SpecialOfferData,
  now: Date,
): void {
  if (
    !Number.isSafeInteger(offer.maxQuantityPerOrder) ||
    offer.maxQuantityPerOrder <= 0
  ) {
    invalidSpecialOffer("Special Offer maxQuantityPerOrder is invalid.");
  }

  if (
    !Number.isSafeInteger(offer.maxQuantityPerCustomer) ||
    offer.maxQuantityPerCustomer <= 0
  ) {
    invalidSpecialOffer("Special Offer maxQuantityPerCustomer is invalid.");
  }

  if (
    !(offer.startsAt instanceof Date) ||
    Number.isNaN(offer.startsAt.getTime()) ||
    !(offer.endsAt instanceof Date) ||
    Number.isNaN(offer.endsAt.getTime()) ||
    offer.startsAt >= offer.endsAt
  ) {
    invalidSpecialOffer("Special Offer date range is invalid.");
  }

  if (
    !(now instanceof Date) ||
    Number.isNaN(now.getTime())
  ) {
    throw new OrderPricingError(
      "Invalid current date.",
      "INVALID_CURRENT_DATE",
      500,
    );
  }

  if (offer.discountType === SpecialOfferDiscountType.PERCENTAGE) {
    if (
      offer.discountPercent === null ||
      offer.discountAmountRial !== null
    ) {
      invalidSpecialOffer("Special Offer percentage configuration is invalid.");
    }

    try {
      percentageToBasisPoints(offer.discountPercent);
    } catch {
      invalidSpecialOffer("Special Offer percentage is invalid.");
    }

    return;
  }

  if (offer.discountType === SpecialOfferDiscountType.FIXED_AMOUNT) {
    if (
      offer.discountAmountRial === null ||
      offer.discountPercent !== null ||
      offer.discountAmountRial < 0n
    ) {
      invalidSpecialOffer("Special Offer fixed discount configuration is invalid.");
    }

    return;
  }

  invalidSpecialOffer("Unsupported Special Offer discount type.");
}

export function calculateSpecialOfferDiscount(input: {
  priceRial: bigint;
  quantity: number;
  offer: SpecialOfferData;
  now?: Date;
  previousCustomerQuantity?: number;
}): SpecialOfferDiscountResult {
  const {
    priceRial,
    quantity,
    offer,
    now = new Date(),
    previousCustomerQuantity = 0,
  } = input;

  assertNonNegativeRial(priceRial, "priceRial");

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new OrderPricingError(
      "Quantity must be a positive safe integer.",
      "INVALID_ORDER_ITEM_QUANTITY",
    );
  }

  if (
    !Number.isSafeInteger(previousCustomerQuantity) ||
    previousCustomerQuantity < 0
  ) {
    throw new OrderPricingError(
      "Previous customer quantity is invalid.",
      "INVALID_CUSTOMER_QUANTITY",
      500,
    );
  }

  validateSpecialOfferConfiguration(offer, now);

  if (!offer.isActive || now < offer.startsAt || now >= offer.endsAt) {
    throw new OrderPricingError(
      "Special Offer is not currently available.",
      "SPECIAL_OFFER_NOT_AVAILABLE",
      409,
    );
  }

  if (quantity > offer.maxQuantityPerOrder) {
    throw new OrderPricingError(
      "Order quantity exceeds the Special Offer per-order limit.",
      "SPECIAL_OFFER_ORDER_LIMIT_EXCEEDED",
      400,
    );
  }

  if (
    previousCustomerQuantity + quantity >
    offer.maxQuantityPerCustomer
  ) {
    throw new OrderPricingError(
      "Customer quantity exceeds the Special Offer per-customer limit.",
      "SPECIAL_OFFER_CUSTOMER_LIMIT_EXCEEDED",
      400,
    );
  }

  let discountPerUnitRial: bigint;

  if (offer.discountType === SpecialOfferDiscountType.PERCENTAGE) {
    discountPerUnitRial = calculatePercentageDiscountRial(
      priceRial,
      offer.discountPercent!,
    );
  } else {
    discountPerUnitRial = calculateFixedDiscountRial(
      priceRial,
      offer.discountAmountRial!,
    );
  }

  const finalUnitPriceRial = priceRial - discountPerUnitRial;
  const rowDiscountAmountRial = discountPerUnitRial * BigInt(quantity);
  const finalRowTotalRial = finalUnitPriceRial * BigInt(quantity);

  return {
    specialOfferId: offer.id,
    originalUnitPriceRial: priceRial,
    discountPerUnitRial,
    finalUnitPriceRial,
    quantity,
    rowDiscountAmountRial,
    finalRowTotalRial,
    couponEligible: false,
  };
}

/**
 * Returns the unique currently valid Special Offer for each requested variant.
 * Multiple overlapping offers for one variant are treated as a configuration error.
 */
export async function getApplicableSpecialOffers(
  variantIds: string[],
  now: Date = new Date(),
  db: DbClient = prisma,
): Promise<Map<string, SpecialOfferData>> {
  if (variantIds.length === 0) {
    return new Map();
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new OrderPricingError(
      "Invalid current date.",
      "INVALID_CURRENT_DATE",
      500,
    );
  }

  const offers = await db.specialOffer.findMany({
    where: {
      variantId: { in: [...new Set(variantIds)] },
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: {
      id: true,
      variantId: true,
      discountType: true,
      discountPercent: true,
      discountAmountRial: true,
      maxQuantityPerOrder: true,
      maxQuantityPerCustomer: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
    },
  });

  const result = new Map<string, SpecialOfferData>();

  for (const offer of offers) {
    if (result.has(offer.variantId)) {
      invalidSpecialOffer(
        `Multiple active Special Offers found for variant ${offer.variantId}.`,
      );
    }

    const normalizedOffer: SpecialOfferData = {
      ...offer,
      discountPercent: offer.discountPercent,
    };

    validateSpecialOfferConfiguration(normalizedOffer, now);
    result.set(offer.variantId, normalizedOffer);
  }

  return result;
}

/**
 * Counts quantities from this customer's non-cancelled orders
 * that have already used the given Special Offer.
 *
 * The current order quantity must be passed separately to
 * calculateSpecialOfferDiscount.
 */
export async function getPreviousSpecialOfferCustomerQuantity(
  specialOfferId: string,
  customerId: string,
  db: DbClient = prisma,
): Promise<number> {
  const result = await db.orderItem.aggregate({
    where: {
        specialOfferId,
        orders: {
            is: {
            customerId,
            status: { not: OrderStatus.CANCELLED },
            },
        },
    },
    _sum: {
      quantity: true,
    },
  });

  return result._sum.quantity ?? 0;
//   return result._sum?.quantity ?? 0;
}

function invalidCouponConfiguration(message: string): never {
  throw new OrderPricingError(
    message,
    "INVALID_COUPON_CONFIGURATION",
    500,
  );
}

function validateCouponConfiguration(coupon: CouponData): void {
  if (!coupon.id || !coupon.code.trim()) {
    invalidCouponConfiguration("Coupon identity is invalid.");
  }

  assertNonNegativeRial(
    coupon.minimumEligibleAmountRial,
    "minimumEligibleAmountRial",
  );

  if (
    coupon.maximumDiscountRial !== null &&
    coupon.maximumDiscountRial < 0n
  ) {
    invalidCouponConfiguration("Coupon maximum discount cannot be negative.");
  }

  if (
    coupon.usageLimit !== null &&
    (!Number.isSafeInteger(coupon.usageLimit) || coupon.usageLimit < 0)
  ) {
    invalidCouponConfiguration("Coupon usage limit is invalid.");
  }

  if (
    !Number.isSafeInteger(coupon.usagePerCustomer) ||
    coupon.usagePerCustomer < 0
  ) {
    invalidCouponConfiguration("Coupon per-customer usage limit is invalid.");
  }

  if (
    !(coupon.startsAt instanceof Date) ||
    Number.isNaN(coupon.startsAt.getTime()) ||
    !(coupon.expiresAt instanceof Date) ||
    Number.isNaN(coupon.expiresAt.getTime()) ||
    coupon.startsAt >= coupon.expiresAt
  ) {
    invalidCouponConfiguration("Coupon date range is invalid.");
  }

  if (coupon.discountType === CouponType.PERCENTAGE) {
    if (
      coupon.discountPercent === null ||
      coupon.discountAmountRial !== null
    ) {
      invalidCouponConfiguration("Coupon percentage configuration is invalid.");
    }

    try {
      percentageToBasisPoints(coupon.discountPercent);
    } catch {
      invalidCouponConfiguration("Coupon percentage is invalid.");
    }

    return;
  }

  if (coupon.discountType === CouponType.FIXED_AMOUNT) {
    if (
      coupon.discountAmountRial === null ||
      coupon.discountPercent !== null ||
      coupon.discountAmountRial < 0n
    ) {
      invalidCouponConfiguration("Coupon fixed discount configuration is invalid.");
    }

    return;
  }

  invalidCouponConfiguration("Unsupported coupon discount type.");
}

/**
 * Validates coupon configuration, active dates and minimum eligible subtotal,
 * then calculates the final coupon discount.
 *
 * The eligible subtotal must already exclude Special Offer items and include
 * regular product discounts.
 */
export function calculateCouponDiscount(input: {
  coupon: CouponData;
  eligibleSubtotalRial: bigint;
  now?: Date;
}): CouponDiscountResult {
  const {
    coupon,
    eligibleSubtotalRial,
    now = new Date(),
  } = input;

  assertNonNegativeRial(
    eligibleSubtotalRial,
    "eligibleSubtotalRial",
  );

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new OrderPricingError(
      "Invalid current date.",
      "INVALID_CURRENT_DATE",
      500,
    );
  }

  validateCouponConfiguration(coupon);

  if (
    !coupon.isActive ||
    now < coupon.startsAt ||
    now >= coupon.expiresAt
  ) {
    throw new OrderPricingError(
      "Coupon is not currently available.",
      "COUPON_NOT_AVAILABLE",
      409,
    );
  }

  if (eligibleSubtotalRial < coupon.minimumEligibleAmountRial) {
    throw new OrderPricingError(
      "Order does not meet the coupon minimum eligible amount.",
      "COUPON_MINIMUM_NOT_MET",
      400,
    );
  }

  let discountAmountRial: bigint;

  if (coupon.discountType === CouponType.PERCENTAGE) {
    discountAmountRial = calculatePercentageDiscountRial(
      eligibleSubtotalRial,
      coupon.discountPercent!,
    );
  } else {
    discountAmountRial = calculateFixedDiscountRial(
      eligibleSubtotalRial,
      coupon.discountAmountRial!,
    );
  }

  if (
    coupon.maximumDiscountRial !== null &&
    discountAmountRial > coupon.maximumDiscountRial
  ) {
    discountAmountRial = coupon.maximumDiscountRial;
  }

  return {
    couponId: coupon.id,
    couponCode: coupon.code,
    eligibleSubtotalRial,
    discountAmountRial,
  };
}

/**
 * Proportionally distributes a coupon discount across eligible order items.
 *
 * Remainder Rial is assigned in the original input order.
 * Special Offer items receive zero coupon discount.
 */

export function allocateCouponDiscount(input: {
  items: CouponEligibleItemInput[];
  couponDiscountAmountRial: bigint;
}): CouponItemAllocation[] {
  const { items, couponDiscountAmountRial } = input;

  assertNonNegativeRial(
    couponDiscountAmountRial,
    "couponDiscountAmountRial",
  );

  const seenVariantIds = new Set<string>();
  let eligibleSubtotalRial = 0n;

  for (const item of items) {
    if (seenVariantIds.has(item.variantId)) {
      throw new OrderPricingError(
        "Duplicate variant IDs are not allowed.",
        "DUPLICATE_ORDER_ITEM",
      );
    }

    seenVariantIds.add(item.variantId);

    assertNonNegativeRial(
      item.subtotalAfterItemDiscountRial,
      "subtotalAfterItemDiscountRial",
    );

    if (item.specialOfferId === null) {
      eligibleSubtotalRial += item.subtotalAfterItemDiscountRial;
    }
  }

  if (couponDiscountAmountRial > eligibleSubtotalRial) {
    throw new OrderPricingError(
      "Coupon discount cannot exceed eligible subtotal.",
      "INVALID_COUPON_DISCOUNT_AMOUNT",
      500,
    );
  }

  const allocations: CouponItemAllocation[] = items.map((item) => ({
    variantId: item.variantId,
    subtotalAfterItemDiscountRial: item.subtotalAfterItemDiscountRial,
    couponDiscountAmountRial: 0n,
    finalTotalRial: item.subtotalAfterItemDiscountRial,
    couponEligible: item.specialOfferId === null,
  }));

  if (couponDiscountAmountRial === 0n || eligibleSubtotalRial === 0n) {
    return allocations;
  }

  let allocatedTotalRial = 0n;

  // First pass: proportional allocation using FLOOR.
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const allocation = allocations[index];

    if (!item || !allocation) {
      throw new OrderPricingError(
        "Coupon allocation index is invalid.",
        "COUPON_ALLOCATION_FAILED",
        500,
      );
    }

    if (
      item.specialOfferId !== null ||
      item.subtotalAfterItemDiscountRial === 0n
    ) {
      continue;
    }

    const allocatedAmount =
      (couponDiscountAmountRial *
        item.subtotalAfterItemDiscountRial) /
      eligibleSubtotalRial;

    allocation.couponDiscountAmountRial = allocatedAmount;
    allocatedTotalRial += allocatedAmount;
  }

  // Second pass: distribute remaining Rial in input order.
  let remainingRial = couponDiscountAmountRial - allocatedTotalRial;

  for (let index = 0; index < items.length && remainingRial > 0n; index++) {
    const item = items[index];
    const allocation = allocations[index];

    if (!item || !allocation) {
      throw new OrderPricingError(
        "Coupon allocation index is invalid.",
        "COUPON_ALLOCATION_FAILED",
        500,
      );
    }

    if (
      item.specialOfferId !== null ||
      allocation.couponDiscountAmountRial >=
        item.subtotalAfterItemDiscountRial
    ) {
      continue;
    }

    allocation.couponDiscountAmountRial += 1n;
    remainingRial -= 1n;
  }

  if (remainingRial !== 0n) {
    throw new OrderPricingError(
      "Coupon discount allocation could not be reconciled.",
      "COUPON_ALLOCATION_FAILED",
      500,
    );
  }

  for (const allocation of allocations) {
    allocation.finalTotalRial =
      allocation.subtotalAfterItemDiscountRial -
      allocation.couponDiscountAmountRial;
  }

  return allocations;
}

export async function validateCouponForCheckout(
  input: {
    code: string;
    customerId?: string | null;
    eligibleSubtotalRial: bigint;
    now?: Date;
  },
  db: DbClient = prisma,
): Promise<{
  coupon: CouponData;
  discount: CouponDiscountResult;
}> {
  const {
    code,
    customerId = null,
    eligibleSubtotalRial,
    now = new Date(),
  } = input;

  const normalizedCode = code.trim();

  if (!normalizedCode) {
    throw new OrderPricingError(
      "Coupon code is required.",
      "COUPON_CODE_REQUIRED",
    );
  }

  const couponRecord = await db.coupon.findUnique({
    where: { code: normalizedCode },
    select: {
      id: true,
      code: true,
      discountType: true,
      discountPercent: true,
      discountAmountRial: true,
      minimumEligibleAmountRial: true,
      maximumDiscountRial: true,
      usageLimit: true,
      usagePerCustomer: true,
      isActive: true,
      startsAt: true,
      expiresAt: true,
    },
  });

  if (!couponRecord) {
    throw new OrderPricingError(
      "Coupon code is invalid.",
      "COUPON_NOT_FOUND",
      404,
    );
  }

  const coupon: CouponData = {
    ...couponRecord,
    discountPercent: couponRecord.discountPercent,
  };

  // Validates active state, date range, minimum subtotal and discount config.
  const discount = calculateCouponDiscount({
    coupon,
    eligibleSubtotalRial,
    now,
  });

  // Global usage limit: null means unlimited.
  if (coupon.usageLimit !== null) {
    const globalUsageCount = await db.couponRedemption.count({
      where: {
        couponId: coupon.id,
      },
    });

    if (globalUsageCount >= coupon.usageLimit) {
      throw new OrderPricingError(
        "Coupon global usage limit has been reached.",
        "COUPON_USAGE_LIMIT_REACHED",
        409,
      );
    }
  }

  // Per-customer usage limit: zero means unlimited.
  // Anonymous customers do not have a per-customer quota.
  if (customerId && coupon.usagePerCustomer > 0) {
    const customerUsageCount = await db.couponRedemption.count({
      where: {
        couponId: coupon.id,
        customerId,
      },
    });

    if (customerUsageCount >= coupon.usagePerCustomer) {
      throw new OrderPricingError(
        "Customer coupon usage limit has been reached.",
        "COUPON_CUSTOMER_USAGE_LIMIT_REACHED",
        409,
      );
    }
  }

  return {
    coupon,
    discount,
  };
}


/**
 * Applies an already-calculated coupon discount to prepared order items.
 *
 * Item discounts must already include either:
 * - Direct product discounts
 * - Special Offer discounts
 *
 * Special Offer items are excluded from coupon allocation.
 *
 * discountAmountRial represents the total row discount,
 * not the discount per unit.
 */
export function allocateCouponDiscountToOrderItems(input: {
  items: OrderItemBeforeCouponInput[];
  couponDiscountAmountRial: bigint;
}): CouponAllocationForOrderResult {
  const { items, couponDiscountAmountRial } = input;

  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderPricingError(
      "An order must contain at least one item.",
      "ORDER_ITEMS_REQUIRED",
    );
  }

  assertNonNegativeRial(
    couponDiscountAmountRial,
    "couponDiscountAmountRial",
  );

  let subtotalRial = 0n;
  let itemDiscountTotalRial = 0n;
  let eligibleSubtotalRial = 0n;

  const couponEligibleItems: CouponEligibleItemInput[] = [];

  for (const item of items) {
    if (
      !item ||
      typeof item.variantId !== "string" ||
      !item.variantId.trim()
    ) {
      throw new OrderPricingError(
        "Invalid order item variant ID.",
        "INVALID_VARIANT_ID",
      );
    }

    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new OrderPricingError(
        "Order item quantity must be a positive safe integer.",
        "INVALID_ORDER_ITEM_QUANTITY",
      );
    }

    if (
      typeof item.productName !== "string" ||
      typeof item.variantTitle !== "string" ||
      typeof item.sku !== "string"
    ) {
      throw new OrderPricingError(
        "Order item snapshot data is invalid.",
        "INVALID_ORDER_ITEM_DATA",
        500,
      );
    }

    assertNonNegativeRial(
      item.unitPriceRial,
      "unitPriceRial",
    );

    assertNonNegativeRial(
      item.discountAmountRial,
      "discountAmountRial",
    );

    const rowSubtotalRial =
      item.unitPriceRial * BigInt(item.quantity);

    if (item.discountAmountRial > rowSubtotalRial) {
      throw new OrderPricingError(
        "Item discount cannot exceed the original row subtotal.",
        "INVALID_ITEM_DISCOUNT_AMOUNT",
        500,
      );
    }

    const subtotalAfterItemDiscountRial =
      rowSubtotalRial - item.discountAmountRial;

    if (
      item.specialOfferId !== null &&
      (
        typeof item.specialOfferId !== "string" ||
        !item.specialOfferId.trim()
      )
    ) {
      throw new OrderPricingError(
        "Invalid Special Offer ID.",
        "INVALID_SPECIAL_OFFER_ID",
        500,
      );
    }

    subtotalRial += rowSubtotalRial;
    itemDiscountTotalRial += item.discountAmountRial;

    if (item.specialOfferId === null) {
      eligibleSubtotalRial += subtotalAfterItemDiscountRial;
    }

    couponEligibleItems.push({
      variantId: item.variantId,
      subtotalAfterItemDiscountRial,
      specialOfferId: item.specialOfferId,
    });
  }

  // Allocate the coupon discount across eligible items.
  const allocations = allocateCouponDiscount({
    items: couponEligibleItems,
    couponDiscountAmountRial,
  });

  const allocationByVariantId = new Map(
    allocations.map((allocation) => [
      allocation.variantId,
      allocation,
    ]),
  );

  let itemsTotalAfterDiscountRial = 0n;
  let allocatedCouponDiscountRial = 0n;

  const pricedItems: OrderItemWithCouponAllocation[] =
    items.map((item) => {
      const allocation = allocationByVariantId.get(
        item.variantId,
      );

      if (!allocation) {
        throw new OrderPricingError(
          "Coupon allocation result is missing for an order item.",
          "COUPON_ALLOCATION_FAILED",
          500,
        );
      }

      const totalPriceRial = allocation.finalTotalRial;

      itemsTotalAfterDiscountRial += totalPriceRial;

      allocatedCouponDiscountRial +=
        allocation.couponDiscountAmountRial;

      return {
        variantId: item.variantId,
        productName: item.productName,
        variantTitle: item.variantTitle,
        sku: item.sku,
        unitPriceRial: item.unitPriceRial,
        quantity: item.quantity,
        discountAmountRial: item.discountAmountRial,
        couponDiscountAmountRial:
          allocation.couponDiscountAmountRial,
        specialOfferId: item.specialOfferId,
        totalPriceRial,
      };
    });

  // Ensure that all allocated coupon amounts reconcile.
  if (allocatedCouponDiscountRial !== couponDiscountAmountRial) {
    throw new OrderPricingError(
      "Allocated coupon discount does not match the requested discount.",
      "COUPON_ALLOCATION_FAILED",
      500,
    );
  }

  const discountTotalRial =
    itemDiscountTotalRial + couponDiscountAmountRial;

  // Final arithmetic consistency check.
  if (
    subtotalRial - discountTotalRial !==
    itemsTotalAfterDiscountRial
  ) {
    throw new OrderPricingError(
      "Order item totals could not be reconciled.",
      "ORDER_PRICING_RECONCILIATION_FAILED",
      500,
    );
  }

  return {
    items: pricedItems,
    subtotalRial,
    itemDiscountTotalRial,
    eligibleSubtotalRial,
    couponDiscountRial: couponDiscountAmountRial,
    discountTotalRial,
    itemsTotalAfterDiscountRial,
  };
}

/**
 * Complete order pricing pipeline.
 *
 * 1. Validates order items against the database.
 * 2. Retrieves applicable Special Offers.
 * 3. Applies Special Offer OR direct product discount.
 * 4. Calculates coupon eligibility.
 * 5. Validates and calculates the coupon, if provided.
 * 6. Allocates coupon discount across eligible items.
 * 7. Calculates final order totals.
 *
 * This function does not create or persist an Order.
 */
export async function calculateOrderPricing(
  input: OrderPricingInput,
  db: DbClient = prisma,
): Promise<OrderPricingResult> {
  const {
    items,
    customerId = null,
    couponCode = null,
    shippingCostRial = 0n,
    taxTotalRial = 0n,
    now = new Date(),
  } = input;

  // Validate evaluation date.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new OrderPricingError(
      "Invalid order pricing evaluation date.",
      "INVALID_CURRENT_DATE",
      500,
    );
  }

  // Validate shipping and tax amounts.
  assertNonNegativeRial(shippingCostRial, "shippingCostRial");
  assertNonNegativeRial(taxTotalRial, "taxTotalRial");

  // Step 1: Validate items and retrieve authoritative product data.
  const validatedItems = await validateOrderItems(items, db);

  // Step 2: Retrieve currently applicable Special Offers.
  const specialOffers = await getApplicableSpecialOffers(
    validatedItems.map((item) => item.variantId),
    now,
    db,
  );

  // Step 3: Calculate item-level discounts.
  const itemsBeforeCoupon: OrderItemBeforeCouponInput[] =
    await Promise.all(
      validatedItems.map(async (item) => {
        const specialOffer = specialOffers.get(item.variantId);

        // Special Offer takes priority over direct product discount.
        if (specialOffer) {
          const previousCustomerQuantity = customerId
            ? await getPreviousSpecialOfferCustomerQuantity(
                specialOffer.id,
                customerId,
                db,
              )
            : 0;

          const specialOfferResult = calculateSpecialOfferDiscount({
            priceRial: item.unitPriceRial,
            quantity: item.quantity,
            offer: specialOffer,
            now,
            previousCustomerQuantity,
          });

          return {
            variantId: item.variantId,
            productName: item.productName,
            variantTitle: item.variantTitle,
            sku: item.sku,
            unitPriceRial: item.unitPriceRial,
            quantity: item.quantity,
            discountAmountRial:
              specialOfferResult.rowDiscountAmountRial,
            specialOfferId: specialOfferResult.specialOfferId,
          };
        }

        // No Special Offer: calculate regular product discount.
        const directDiscount = calculateDirectProductDiscount({
          priceRial: item.unitPriceRial,
          discountType: item.discountType,
          discountPercent: item.discountPercent,
          discountAmountRial: item.discountAmountRial,
          discountStartsAt: item.discountStartsAt,
          discountEndsAt: item.discountEndsAt,
          isDiscountActive: item.isDiscountActive,
          now,
        });

        const rowDiscountAmountRial =
          directDiscount.discountPerUnitRial *
          BigInt(item.quantity);

        return {
          variantId: item.variantId,
          productName: item.productName,
          variantTitle: item.variantTitle,
          sku: item.sku,
          unitPriceRial: item.unitPriceRial,
          quantity: item.quantity,
          discountAmountRial: rowDiscountAmountRial,
          specialOfferId: null,
        };
      }),
    );

  // Step 4: Calculate eligible subtotal after item discounts.
  const eligibleSubtotalRial = itemsBeforeCoupon.reduce(
    (total, item) => {
      if (item.specialOfferId !== null) {
        return total;
      }

      const rowSubtotal =
        item.unitPriceRial * BigInt(item.quantity);

      return total + rowSubtotal - item.discountAmountRial;
    },
    0n,
  );

  // Step 5: Validate and calculate coupon, if supplied.
  let coupon: CouponDiscountResult | null = null;

  if (couponCode !== null) {
    const couponValidation = await validateCouponForCheckout(
      {
        code: couponCode,
        customerId,
        eligibleSubtotalRial,
        now,
      },
      db,
    );

    coupon = couponValidation.discount;
  }

  // Step 6: Allocate coupon discount to order items.
  const allocationResult = allocateCouponDiscountToOrderItems({
    items: itemsBeforeCoupon,
    couponDiscountAmountRial: coupon?.discountAmountRial ?? 0n,
  });

  // Step 7: Calculate final order totals.
  const grandTotalRial =
    allocationResult.itemsTotalAfterDiscountRial +
    shippingCostRial +
    taxTotalRial;

  return {
    items: allocationResult.items,

    subtotalRial: allocationResult.subtotalRial,
    itemDiscountTotalRial:
      allocationResult.itemDiscountTotalRial,
    couponDiscountRial:
      allocationResult.couponDiscountRial,
    discountTotalRial:
      allocationResult.discountTotalRial,

    shippingCostRial,
    taxTotalRial,
    grandTotalRial,

    coupon,
  };
}