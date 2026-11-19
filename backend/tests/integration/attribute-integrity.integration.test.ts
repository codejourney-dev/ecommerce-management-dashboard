import { config } from "dotenv";
config({ path: ".env.test" });
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';


const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not defined.');
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, '');

if (databaseName !== 'ecommerce_dashboard_migration_test') {
  throw new Error(
    `Unsafe integration-test database: "${databaseName}". ` +
      'These tests may run only against ecommerce_dashboard_migration_test.',
  );
}

const { prisma } = await import('../../src/config/prisma.js');

type Scope = 'PRODUCT' | 'VARIANT';
type InputType =
  | 'TEXT'
  | 'NUMBER'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'BOOLEAN'
  | 'DATE';

type Fixture = {
  categoryId: string;
  productId: string;
  variantId: string;
  attributeId: string;
  categoryAttributeId: string;
  activeOptionIds: string[];
  inactiveOptionId: string;
};

const fixtures: Fixture[] = [];

function getFirstActiveOptionId(fixture: Fixture): string {
  const optionId = fixture.activeOptionIds[0];
  if (!optionId) {
    throw new Error(
      'No active attribute option found in integration test fixture.',
    );
  }
  return optionId;
}

async function createFixture(
  inputType: InputType,
  scope: Scope = 'PRODUCT',
): Promise<Fixture> {
  const suffix = randomUUID();

  const category = await prisma.category.create({
    data: {
      name: `Integration category ${suffix}`,
      slug: `integration-category-${suffix}`,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: `Integration product ${suffix}`,
      slug: `integration-product-${suffix}`,
      description: 'Created by attribute-integrity integration tests.',
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `INT-${suffix}`,
      title: 'Integration variant',
      priceRial: 100000n,
    },
  });

  const attribute = await prisma.attribute.create({
    data: {
      name: `Integration attribute ${suffix}`,
      slug: `integration-attribute-${suffix}`,
      inputType,
    },
  });

  const categoryAttribute = await prisma.categoryAttribute.create({
    data: {
      categoryId: category.id,
      attributeId: attribute.id,
      scope,
    },
  });

  const activeOptions = await Promise.all(
    ['first', 'second'].map((value, index) =>
      prisma.attributeOption.create({
        data: {
          attributeId: attribute.id,
          label: `Option ${index + 1}`,
          value: `${value}-${suffix}`,
          position: index,
        },
      }),
    ),
  );

  const inactiveOption = await prisma.attributeOption.create({
    data: {
      attributeId: attribute.id,
      label: 'Inactive option',
      value: `inactive-${suffix}`,
      position: 2,
      isActive: false,
    },
  });

  const fixture: Fixture = {
    categoryId: category.id,
    productId: product.id,
    variantId: variant.id,
    attributeId: attribute.id,
    categoryAttributeId: categoryAttribute.id,
    activeOptionIds: activeOptions.map((option) => option.id),
    inactiveOptionId: inactiveOption.id,
  };

  fixtures.push(fixture);
  return fixture;
}

async function createProductValue(
  fixture: Fixture,
  data: {
    textValue?: string | null;
    numberValue?: number | null;
    booleanValue?: boolean | null;
    dateValue?: Date | null;
    optionId?: string | null;
  } = {},
) {
  return prisma.productAttributeValue.create({
    data: {
      productId: fixture.productId,
      categoryAttributeId: fixture.categoryAttributeId,
      attributeId: fixture.attributeId,
      ...data,
    },
  });
}

async function createVariantValue(
  fixture: Fixture,
  data: {
    textValue?: string | null;
    numberValue?: number | null;
    booleanValue?: boolean | null;
    dateValue?: Date | null;
    optionId?: string | null;
  } = {},
) {
  return prisma.variantAttributeValue.create({
    data: {
      variantId: fixture.variantId,
      categoryAttributeId: fixture.categoryAttributeId,
      attributeId: fixture.attributeId,
      ...data,
    },
  });
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedMessage: string,
) {
  let caught: unknown;

  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  expect(caught, 'Expected the database operation to fail').toBeDefined();

  const errorText =
    caught instanceof Error
      ? `${caught.message} ${JSON.stringify(
          'meta' in caught ? caught.meta : undefined,
        )}`
      : String(caught);

  expect(errorText).toContain(expectedMessage);
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    // Delete value rows before their category-attribute definition.
    await prisma.variantAttributeValue.deleteMany({
      where: { variantId: fixture.variantId },
    });
    await prisma.productAttributeValue.deleteMany({
      where: { productId: fixture.productId },
    });

    // ProductVariant uses RESTRICT when its parent product is deleted.
    await prisma.productVariant.deleteMany({
      where: { id: fixture.variantId },
    });
    await prisma.product.deleteMany({
      where: { id: fixture.productId },
    });

    await prisma.categoryAttribute.deleteMany({
      where: { id: fixture.categoryAttributeId },
    });
    await prisma.category.deleteMany({
      where: { id: fixture.categoryId },
    });
    await prisma.attribute.deleteMany({
      where: { id: fixture.attributeId },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Attribute integrity – product values', () => {
  it('accepts a valid TEXT value', async () => {
    const fixture = await createFixture('TEXT');

    const value = await createProductValue(fixture, {
      textValue: 'Cotton',
    });

    expect(value.textValue).toBe('Cotton');
  });

  it('rejects a TEXT attribute without text_value', async () => {
    const fixture = await createFixture('TEXT');

    await expectDatabaseError(
      createProductValue(fixture),
      'Invalid TEXT attribute value',
    );
  });

  it('rejects a value whose populated field does not match the input type', async () => {
    const fixture = await createFixture('NUMBER');

    await expectDatabaseError(
      createProductValue(fixture, { textValue: 'Not a number' }),
      'Invalid NUMBER attribute value',
    );
  });

  it('rejects a PRODUCT value linked to a VARIANT-scoped category attribute', async () => {
    const fixture = await createFixture('TEXT', 'VARIANT');

    await expectDatabaseError(
      createProductValue(fixture, { textValue: 'Invalid scope' }),
      'Attribute scope must be PRODUCT',
    );
  });

  it('accepts a SELECT value with an active option of the same attribute', async () => {
    const fixture = await createFixture('SELECT');

    const value = await createProductValue(fixture, {
      optionId: fixture.activeOptionIds[0],
    });

    expect(value.optionId).toBe(fixture.activeOptionIds[0]);
  });

  it('rejects an inactive option for a SELECT value', async () => {
    const fixture = await createFixture('SELECT');

    await expectDatabaseError(
      createProductValue(fixture, {
        optionId: fixture.inactiveOptionId,
      }),
      'SELECT requires an active option',
    );
  });

  it('rejects scalar fields for a MULTI_SELECT parent value', async () => {
    const fixture = await createFixture('MULTI_SELECT');

    await expectDatabaseError(
      createProductValue(fixture, { textValue: 'Must not be stored here' }),
      'MULTI_SELECT cannot use scalar values',
    );
  });

  it('requires at least one selected option for a MULTI_SELECT product value at transaction commit', async () => {
    const fixture = await createFixture('MULTI_SELECT');

    await expectDatabaseError(
      prisma.$transaction(async (tx) => {
        await tx.productAttributeValue.create({
          data: {
            productId: fixture.productId,
            categoryAttributeId: fixture.categoryAttributeId,
            attributeId: fixture.attributeId,
          },
        });
      }),
      'MULTI_SELECT attribute value must have at least one selected option',
    );
  });

  it('accepts a MULTI_SELECT product value when an active option is inserted in the same transaction', async () => {
    const fixture = await createFixture('MULTI_SELECT');

    const value = await prisma.$transaction(async (tx) => {
      const parent = await tx.productAttributeValue.create({
        data: {
          productId: fixture.productId,
          categoryAttributeId: fixture.categoryAttributeId,
          attributeId: fixture.attributeId,
        },
      });

      await tx.productAttributeValueOption.create({
        data: {
          productAttributeValueId: parent.id,
          optionId: getFirstActiveOptionId(fixture),
        },
      });

      return parent;
    });

    expect(value.id).toBeTruthy();
  });

  it('rejects deleting the last selected option from a MULTI_SELECT product value', async () => {
    const fixture = await createFixture('MULTI_SELECT');

    const value = await prisma.$transaction(async (tx) => {
      const parent = await tx.productAttributeValue.create({
        data: {
          productId: fixture.productId,
          categoryAttributeId: fixture.categoryAttributeId,
          attributeId: fixture.attributeId,
        },
      });

      await tx.productAttributeValueOption.create({
        data: {
          productAttributeValueId: parent.id,
          optionId: getFirstActiveOptionId(fixture),
        },
      });

      return parent;
    });

    await expectDatabaseError(
      prisma.$transaction(async (tx) => {
        await tx.productAttributeValueOption.delete({
          where: {
            productAttributeValueId_optionId: {
              productAttributeValueId: value.id,
              optionId: getFirstActiveOptionId(fixture),
            },
          },
        });
      }),
      'MULTI_SELECT attribute value must have at least one selected option',
    );
  });

  it('rejects an inactive option in a MULTI_SELECT selection row', async () => {
    const fixture = await createFixture('MULTI_SELECT');

    await expectDatabaseError(
      prisma.$transaction(async (tx) => {
        const parent = await tx.productAttributeValue.create({
          data: {
            productId: fixture.productId,
            categoryAttributeId: fixture.categoryAttributeId,
            attributeId: fixture.attributeId,
          },
        });

        await tx.productAttributeValueOption.create({
          data: {
            productAttributeValueId: parent.id,
            optionId: fixture.inactiveOptionId,
          },
        });
      }),
      'Inactive option cannot be selected',
    );
  });

  it('rejects selection rows attached to a non-MULTI_SELECT attribute', async () => {
    const fixture = await createFixture('TEXT');

    await expectDatabaseError(
      prisma.$transaction(async (tx) => {
        const parent = await tx.productAttributeValue.create({
          data: {
            productId: fixture.productId,
            categoryAttributeId: fixture.categoryAttributeId,
            attributeId: fixture.attributeId,
            textValue: 'Valid scalar value',
          },
        });

        await tx.productAttributeValueOption.create({
          data: {
            productAttributeValueId: parent.id,
            optionId: getFirstActiveOptionId(fixture),
          },
        });
      }),
      'Selection rows are allowed only for MULTI_SELECT attributes',
    );
  });
});

describe('Attribute integrity – variant values', () => {
  it('accepts a valid VARIANT-scoped BOOLEAN value', async () => {
    const fixture = await createFixture('BOOLEAN', 'VARIANT');

    const value = await createVariantValue(fixture, {
      booleanValue: true,
    });

    expect(value.booleanValue).toBe(true);
  });

  it('rejects a PRODUCT-scoped category attribute for a variant value', async () => {
    const fixture = await createFixture('TEXT', 'PRODUCT');

    await expectDatabaseError(
      createVariantValue(fixture, { textValue: 'Invalid scope' }),
      'Attribute scope must be VARIANT',
    );
  });

  it('requires at least one selected option for a MULTI_SELECT variant value at transaction commit', async () => {
    const fixture = await createFixture('MULTI_SELECT', 'VARIANT');

    await expectDatabaseError(
      prisma.$transaction(async (tx) => {
        await tx.variantAttributeValue.create({
          data: {
            variantId: fixture.variantId,
            categoryAttributeId: fixture.categoryAttributeId,
            attributeId: fixture.attributeId,
          },
        });
      }),
      'MULTI_SELECT attribute value must have at least one selected option',
    );
  });

  it('accepts a MULTI_SELECT variant value when an active option is inserted in the same transaction', async () => {
    const fixture = await createFixture('MULTI_SELECT', 'VARIANT');

    const value = await prisma.$transaction(async (tx) => {
      const parent = await tx.variantAttributeValue.create({
        data: {
          variantId: fixture.variantId,
          categoryAttributeId: fixture.categoryAttributeId,
          attributeId: fixture.attributeId,
        },
      });

      await tx.variantAttributeValueOption.create({
        data: {
          variantAttributeValueId: parent.id,
          optionId: getFirstActiveOptionId(fixture),
        },
      });

      return parent;
    });

    expect(value.id).toBeTruthy();
  });

  it('rejects an inactive option in a MULTI_SELECT variant selection row', async () => {
    const fixture = await createFixture('MULTI_SELECT', 'VARIANT');

    await expectDatabaseError(
      prisma.$transaction(async (tx) => {
        const parent = await tx.variantAttributeValue.create({
          data: {
            variantId: fixture.variantId,
            categoryAttributeId: fixture.categoryAttributeId,
            attributeId: fixture.attributeId,
          },
        });

        await tx.variantAttributeValueOption.create({
          data: {
            variantAttributeValueId: parent.id,
            optionId: fixture.inactiveOptionId,
          },
        });
      }),
      'Inactive option cannot be selected',
    );
  });
});
