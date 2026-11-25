
type DecimalLike = {
  toFixed(decimalPlaces?: number): string;
};

export type PercentageInput = string | DecimalLike;

/**
 * Ensures a Rial amount is a non-negative bigint.
 */
export function assertNonNegativeRial(
  amount: bigint,
  fieldName = "amount",
): void {
  if (amount < 0n) {
    throw new Error(`${fieldName} cannot be negative.`);
  }
}

/**
 * Converts a percentage into basis points.
 *
 * Example:
 * "12.50" => 1250
 * "5"     => 500
 */
export function percentageToBasisPoints(
  percentage: PercentageInput,
): bigint {
  const value =
    typeof percentage === "string"
      ? percentage
      : percentage.toFixed(2);

  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Invalid percentage value.");
  }

  const [whole = "0", fraction = ""] = value.split(".");

  const basisPoints =
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0"));

  if (basisPoints > 10_000n) {
    throw new Error("Percentage cannot exceed 100.");
  }

  return basisPoints;
}

/**
 * Calculates a percentage discount using FLOOR rounding.
 *
 * Example:
 * 999 Rial × 12.50% = 124 Rial
 */
export function calculatePercentageDiscountRial(
  amountRial: bigint,
  percentage: PercentageInput,
): bigint {
  assertNonNegativeRial(amountRial, "amountRial");

  const basisPoints = percentageToBasisPoints(percentage);

  return (amountRial * basisPoints) / 10_000n;
}

/**
 * Calculates a fixed discount, capped at the available amount.
 */
export function calculateFixedDiscountRial(
  amountRial: bigint,
  discountRial: bigint,
): bigint {
  assertNonNegativeRial(amountRial, "amountRial");
  assertNonNegativeRial(discountRial, "discountRial");

  return discountRial > amountRial
    ? amountRial
    : discountRial;
}
