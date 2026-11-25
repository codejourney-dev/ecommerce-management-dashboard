
import { describe, expect, it } from "vitest";

import {
  assertNonNegativeRial,
  calculatePercentageDiscountRial,
  calculateFixedDiscountRial,
} from "../../../src/utils/money.js";

describe("Money utilities", () => {
  describe("assertNonNegativeRial", () => {
    it("accepts zero and positive amounts", () => {
      expect(() => assertNonNegativeRial(0n)).not.toThrow();
      expect(() => assertNonNegativeRial(1000n)).not.toThrow();
    });

    it("rejects negative amounts", () => {
      expect(() => assertNonNegativeRial(-1n)).toThrow(
        "amount cannot be negative.",
      );
    });
  });

  describe("calculatePercentageDiscountRial", () => {
    it("calculates percentage discounts", () => {
      expect(
        calculatePercentageDiscountRial(10_000n, "10"),
      ).toBe(1_000n);
    });

    it("supports decimal percentages", () => {
      expect(
        calculatePercentageDiscountRial(10_000n, "12.50"),
      ).toBe(1_250n);
    });

    it("rounds fractional Rial amounts down", () => {
      expect(
        calculatePercentageDiscountRial(999n, "12.50"),
      ).toBe(124n);
    });

    it("returns zero for a zero percentage", () => {
      expect(
        calculatePercentageDiscountRial(10_000n, "0"),
      ).toBe(0n);
    });

    it("supports a 100 percent discount", () => {
      expect(
        calculatePercentageDiscountRial(10_000n, "100"),
      ).toBe(10_000n);
    });

    it("rejects percentages greater than 100", () => {
      expect(() =>
        calculatePercentageDiscountRial(10_000n, "100.01"),
      ).toThrow("Percentage cannot exceed 100.");
    });

    it("rejects invalid percentage formats", () => {
      expect(() =>
        calculatePercentageDiscountRial(10_000n, "-5"),
      ).toThrow("Invalid percentage value.");

      expect(() =>
        calculatePercentageDiscountRial(10_000n, "10.555"),
      ).toThrow("Invalid percentage value.");
    });

    it("rejects negative amounts", () => {
      expect(() =>
        calculatePercentageDiscountRial(-100n, "10"),
      ).toThrow("amountRial cannot be negative.");
    });
  });

  describe("calculateFixedDiscountRial", () => {
    it("returns the requested fixed discount", () => {
      expect(
        calculateFixedDiscountRial(10_000n, 2_000n),
      ).toBe(2_000n);
    });

    it("does not allow discount greater than the amount", () => {
      expect(
        calculateFixedDiscountRial(1_000n, 2_000n),
      ).toBe(1_000n);
    });

    it("returns zero for a zero discount", () => {
      expect(
        calculateFixedDiscountRial(1_000n, 0n),
      ).toBe(0n);
    });

    it("rejects negative amounts", () => {
      expect(() =>
        calculateFixedDiscountRial(-1n, 100n),
      ).toThrow("amountRial cannot be negative.");
    });

    it("rejects negative discounts", () => {
      expect(() =>
        calculateFixedDiscountRial(1_000n, -1n),
      ).toThrow("discountRial cannot be negative.");
    });
  });
});
