import { config } from "dotenv";
config({ path: ".env.test" });
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

// This suite is allowed to use only the dedicated migration-test database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");
if (databaseName !== "ecommerce_dashboard_migration_test") {
  throw new Error(
    `Unsafe integration-test database: "${databaseName}". ` +
      "These tests may run only against ecommerce_dashboard_migration_test.",
  );
}

const { prisma } = await import("../../src/config/prisma.js");
const {
  setBrandCategories,
  getAvailableBrandsByCategory,
} = await import("../../src/services/brand.service.js");

const createdProductIds: string[] = [];
const createdBrandIds: string[] = [];
const createdCategoryIds: string[] = [];

async function createCategory(
  parentId?: string,
  isActive = true,
) {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: `Brand edge category ${suffix}`,
      slug: `brand-edge-category-${suffix}`,
      isActive,
      ...(parentId ? { parentId } : {}),
    },
  });

  createdCategoryIds.push(category.id);
  return category;
}

async function createBrand() {
  const suffix = randomUUID();
  const brand = await prisma.brand.create({
    data: {
      name: `Brand edge ${suffix}`,
      slug: `brand-edge-${suffix}`,
    },
  });
  createdBrandIds.push(brand.id);
  return brand;
}

async function createProduct(input: {
  brandId: string;
  categoryIds: string[];
}) {
  const suffix = randomUUID();
  const product = await prisma.product.create({
    data: {
      name: `Brand edge product ${suffix}`,
      slug: `brand-edge-product-${suffix}`,
      description: "Integration test fixture",
      brandId: input.brandId,
      categories: {
        create: input.categoryIds.map((categoryId) => ({ categoryId })),
      },
    },
  });
  createdProductIds.push(product.id);
  return product;
}

afterEach(async () => {
  if (createdProductIds.length) {
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds.splice(0) } },
    });
  }

  if (createdBrandIds.length) {
    await prisma.categoryBrand.deleteMany({
      where: { brandId: { in: createdBrandIds } },
    });
    await prisma.brand.deleteMany({
      where: { id: { in: createdBrandIds.splice(0) } },
    });
  }

  for (const id of createdCategoryIds.splice(0).reverse()) {
    await prisma.category.deleteMany({ where: { id } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Brand Management edge cases", () => {
  it("clears all direct category assignments when an empty list is submitted and no products use the brand", async () => {
    const first = await createCategory();
    const second = await createCategory();
    const brand = await createBrand();

    await prisma.categoryBrand.createMany({
      data: [
        { brandId: brand.id, categoryId: first.id },
        { brandId: brand.id, categoryId: second.id },
      ],
    });

    const result = await setBrandCategories(brand.id, []);

    expect(result.categoryBrands).toHaveLength(0);

    const remaining = await prisma.categoryBrand.count({
      where: { brandId: brand.id },
    });
    expect(remaining).toBe(0);
  });

  it("deduplicates repeated category IDs", async () => {
    const category = await createCategory();
    const brand = await createBrand();

    const result = await setBrandCategories(brand.id, [
      category.id,
      category.id,
      category.id,
    ]);

    expect(result.categoryBrands).toHaveLength(1);
    expect(result.categoryBrands[0]?.categoryId).toBe(category.id);
  });

  it("does not change existing assignments when a requested category does not exist", async () => {
    const existingCategory = await createCategory();
    const brand = await createBrand();

    await prisma.categoryBrand.create({
      data: {
        brandId: brand.id,
        categoryId: existingCategory.id,
      },
    });

    await expect(
      setBrandCategories(brand.id, [randomUUID()]),
    ).rejects.toMatchObject({
      name: "BrandServiceError",
      code: "CATEGORY_NOT_FOUND",
      statusCode: 404,
    });

    const existingAssignment = await prisma.categoryBrand.findUnique({
      where: {
        categoryId_brandId: {
          categoryId: existingCategory.id,
          brandId: brand.id,
        },
      },
    });
    expect(existingAssignment).not.toBeNull();
  });

  it("allows a product with multiple categories when at least one remains assigned to its brand", async () => {
    const firstCategory = await createCategory();
    const secondCategory = await createCategory();
    const brand = await createBrand();

    await createProduct({
      brandId: brand.id,
      categoryIds: [firstCategory.id, secondCategory.id],
    });

    const result = await setBrandCategories(brand.id, [secondCategory.id]);

    expect(result.categoryBrands).toHaveLength(1);
    expect(result.categoryBrands[0]?.categoryId).toBe(secondCategory.id);
  });

  it("rejects clearing assignments when an existing product uses the brand and preserves the old assignment", async () => {
    const category = await createCategory();
    const brand = await createBrand();

    await prisma.categoryBrand.create({
      data: { brandId: brand.id, categoryId: category.id },
    });
    await createProduct({
      brandId: brand.id,
      categoryIds: [category.id],
    });

    await expect(setBrandCategories(brand.id, [])).rejects.toMatchObject({
      name: "BrandServiceError",
      code: "BRAND_CATEGORY_ASSIGNMENT_CONFLICT",
      statusCode: 409,
    });

    const assignment = await prisma.categoryBrand.findUnique({
      where: {
        categoryId_brandId: {
          categoryId: category.id,
          brandId: brand.id,
        },
      },
    });
    expect(assignment).not.toBeNull();
  });

  it("rejects assigning categories to an unknown brand", async () => {
    const category = await createCategory();

    await expect(
      setBrandCategories(randomUUID(), [category.id]),
    ).rejects.toMatchObject({
      name: "BrandServiceError",
      code: "BRAND_NOT_FOUND",
      statusCode: 404,
    });

    expect(
      await prisma.categoryBrand.count({ where: { categoryId: category.id } }),
    ).toBe(0);
  });

  it("does not return a brand assigned only to an inactive leaf category", async () => {
    const parent = await createCategory();
    const inactiveLeaf = await createCategory(parent.id, false);
    const brand = await createBrand();

    await prisma.categoryBrand.create({
      data: {
        brandId: brand.id,
        categoryId: inactiveLeaf.id,
      },
    });

    const result = await getAvailableBrandsByCategory(inactiveLeaf.id);

    expect(result).toHaveLength(0);
  });

  it("returns a brand assigned to an inactive leaf when it is also assigned to an active sibling leaf", async () => {
    const parent = await createCategory();
    const inactiveLeaf = await createCategory(parent.id, false);
    const activeSibling = await createCategory(parent.id);
    const brand = await createBrand();

    await prisma.categoryBrand.createMany({
      data: [
        {
          brandId: brand.id,
          categoryId: inactiveLeaf.id,
        },
        {
          brandId: brand.id,
          categoryId: activeSibling.id,
        },
      ],
    });

    const result = await getAvailableBrandsByCategory(inactiveLeaf.id);

    expect(result.map((item) => item.id)).toContain(brand.id);
    expect(result).toHaveLength(1);
  });

  it("returns brands from active child leaves when the parent category is inactive", async () => {
    const inactiveParent = await createCategory(undefined, false);
    const activeLeaf = await createCategory(inactiveParent.id);
    const brand = await createBrand();

    await prisma.categoryBrand.create({
      data: {
        brandId: brand.id,
        categoryId: activeLeaf.id,
      },
    });

    const result = await getAvailableBrandsByCategory(inactiveParent.id);

    expect(result.map((item) => item.id)).toContain(brand.id);
    expect(result).toHaveLength(1);
  });

  it("aggregates brands from multiple active descendant leaves of an inactive parent", async () => {
    const inactiveParent = await createCategory(undefined, false);

    const firstActiveLeaf = await createCategory(inactiveParent.id);
    const secondActiveLeaf = await createCategory(inactiveParent.id);

    const firstBrand = await createBrand();
    const secondBrand = await createBrand();

    await prisma.categoryBrand.createMany({
      data: [
        {
          brandId: firstBrand.id,
          categoryId: firstActiveLeaf.id,
        },
        {
          brandId: secondBrand.id,
          categoryId: secondActiveLeaf.id,
        },
      ],
    });

    const result = await getAvailableBrandsByCategory(inactiveParent.id);

    const resultBrandIds = result.map((item) => item.id);

    expect(result).toHaveLength(2);
    expect(resultBrandIds).toContain(firstBrand.id);
    expect(resultBrandIds).toContain(secondBrand.id);
  });
});
