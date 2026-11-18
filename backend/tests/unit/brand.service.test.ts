import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/config/prisma.js", () => ({
  prisma: prismaMock,
}));

import {
  BrandServiceError,
  setBrandCategories,
} from "../../src/services/brand.service.js";

function makeP2034Error() {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    {
      code: "P2034",
      clientVersion: "unit-test",
      meta: {},
    },
  );
}

describe("setBrandCategories transaction retry", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
  });

  it("retries a P2034 conflict and succeeds when a later attempt works", async () => {
    const expected = { id: "brand-id", categoryBrands: [] };

    prismaMock.$transaction
      .mockRejectedValueOnce(makeP2034Error())
      .mockRejectedValueOnce(makeP2034Error())
      .mockResolvedValueOnce(expected);

    await expect(setBrandCategories("brand-id", [])).resolves.toBe(expected);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(prismaMock.$transaction.mock.calls[0]?.[1]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("returns a controlled 409 service error after the retry limit is exhausted", async () => {
    prismaMock.$transaction
      .mockRejectedValueOnce(makeP2034Error())
      .mockRejectedValueOnce(makeP2034Error())
      .mockRejectedValueOnce(makeP2034Error());

    await expect(setBrandCategories("brand-id", [])).rejects.toMatchObject({
      name: "BrandServiceError",
      code: "BRAND_UPDATE_CONFLICT",
      statusCode: 409,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry errors other than P2034", async () => {
    const databaseError = new Error("Unexpected database failure");
    prismaMock.$transaction.mockRejectedValueOnce(databaseError);

    await expect(setBrandCategories("brand-id", [])).rejects.toBe(
      databaseError,
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
