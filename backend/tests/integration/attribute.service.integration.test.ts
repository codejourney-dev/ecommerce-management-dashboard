
import { config } from "dotenv";
config({ path: ".env.test" });

import {
    afterAll,
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';

import { randomUUID } from 'node:crypto';
import { AttributeInputType } from '../../generated/prisma/client.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('DATABASE_URL is not defined.');
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, '');

if (databaseName !== 'ecommerce_dashboard_migration_test') {
    throw new Error(
        `Unsafe integration-test database: "${databaseName}". ` +
        'These tests may run only against ecommerce_dashboard_migration_test.'
    );
}

const { prisma } = await import('../../src/config/prisma.js');

const {
    AttributeServiceError,
    createAttribute,
    listAttributes,
    getAttributeById,
    updateAttribute,
    updateAttributeStatus,
    deleteAttribute,
} = await import('../../src/services/attribute.service.js');

const createdAttributeIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdCategoryAttributeIds: string[] = [];

function uniqueSuffix() {
    return randomUUID();
}

async function createTestAttribute(
    inputType: AttributeInputType = AttributeInputType.TEXT
) {
    const suffix = uniqueSuffix();

    const attribute = await createAttribute({
        name: `Test attribute ${suffix}`,
        slug: `test-attribute-${suffix}`,
        inputType,
    });

    createdAttributeIds.push(attribute.id);

    return attribute;
}

async function assignAttributeToCategory(
    attributeId: string
) {
    const suffix = uniqueSuffix();

    const category = await prisma.category.create({
        data: {
            name: `Test category ${suffix}`,
            slug: `test-category-${suffix}`,
        },
    });

    createdCategoryIds.push(category.id);

    const categoryAttribute = await prisma.categoryAttribute.create({
        data: {
            categoryId: category.id,
            attributeId,
            scope: 'PRODUCT',
        },
    });

    createdCategoryAttributeIds.push(categoryAttribute.id);

    return categoryAttribute;
}

afterEach(async () => {
    if (createdCategoryAttributeIds.length > 0) {
        await prisma.categoryAttribute.deleteMany({
            where: {
                id: { in: createdCategoryAttributeIds.splice(0) },
            },
        });
    }

    if (createdCategoryIds.length > 0) {
        await prisma.category.deleteMany({
            where: {
                id: { in: createdCategoryIds.splice(0) },
            },
        });
    }

    if (createdAttributeIds.length > 0) {
        await prisma.attribute.deleteMany({
            where: {
                id: { in: createdAttributeIds.splice(0) },
            },
        });
    }
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('Attribute Service – CRUD', () => {

    it('creates an attribute', async () => {
        const attribute = await createTestAttribute();

        expect(attribute.id).toBeTruthy();
        expect(attribute.inputType).toBe('TEXT');
        expect(attribute.isActive).toBe(true);
    });

    it('rejects duplicate slugs', async () => {
        const attribute = await createTestAttribute();

        await expect(
            createAttribute({
                name: 'Duplicate attribute',
                slug: attribute.slug,
                inputType: AttributeInputType.TEXT,
            })
        ).rejects.toMatchObject({
            name: 'AttributeServiceError',
            code: 'ATTRIBUTE_SLUG_EXISTS',
            statusCode: 409,
        });
    });

    it('lists attributes with pagination', async () => {
        await createTestAttribute();
        await createTestAttribute();

        const result = await listAttributes({
            page: 1,
            limit: 1,
        });

        expect(result.attributes).toHaveLength(1);
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(1);
        expect(result.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('filters attributes by input type', async () => {
        const attribute = await createTestAttribute(
            AttributeInputType.NUMBER
        );

        const result = await listAttributes({
            inputType: AttributeInputType.NUMBER,
            search: attribute.slug,
        });

        expect(
            result.attributes.some(
                item => item.id === attribute.id
            )
        ).toBe(true);
    });

    it('gets an attribute by ID with its relations', async () => {
        const attribute = await createTestAttribute();

        const result = await getAttributeById(attribute.id);

        expect(result.id).toBe(attribute.id);
        expect(result.options).toEqual([]);
        expect(result.categoryAttributes).toEqual([]);
    });

    it('returns 404 for a missing attribute', async () => {
        await expect(
            getAttributeById(randomUUID())
        ).rejects.toMatchObject({
            name: 'AttributeServiceError',
            code: 'ATTRIBUTE_NOT_FOUND',
            statusCode: 404,
        });
    });

    it('updates attribute name and slug', async () => {
        const attribute = await createTestAttribute();

        const result = await updateAttribute(attribute.id, {
            name: 'Updated attribute',
            slug: `updated-${uniqueSuffix()}`,
        });

        expect(result.name).toBe('Updated attribute');
        expect(result.slug).toContain('updated-');
    });

    it('allows changing input type when no category is assigned', async () => {
        const attribute = await createTestAttribute();

        const result = await updateAttribute(attribute.id, {
            inputType: AttributeInputType.NUMBER,
        });

        expect(result.inputType).toBe('NUMBER');
    });

    it('rejects changing input type when assigned to a category', async () => {
        const attribute = await createTestAttribute();

        await assignAttributeToCategory(attribute.id);

        await expect(
            updateAttribute(attribute.id, {
                inputType: AttributeInputType.NUMBER,
            })
        ).rejects.toMatchObject({
            name: 'AttributeServiceError',
            code: 'ATTRIBUTE_INPUT_TYPE_IN_USE',
            statusCode: 409,
        });
    });

    it('updates attribute status', async () => {
        const attribute = await createTestAttribute();

        const result = await updateAttributeStatus(
            attribute.id,
            false
        );

        expect(result.isActive).toBe(false);
    });

    it('deletes an attribute without dependencies', async () => {
        const attribute = await createTestAttribute();

        const result = await deleteAttribute(attribute.id);

        expect(result.id).toBe(attribute.id);

        // It has already been deleted successfully.
        createdAttributeIds.splice(
            createdAttributeIds.indexOf(attribute.id),
            1
        );
    });

    it('rejects deleting an attribute assigned to a category', async () => {
        const attribute = await createTestAttribute();

        await assignAttributeToCategory(attribute.id);

        await expect(
            deleteAttribute(attribute.id)
        ).rejects.toMatchObject({
            name: 'AttributeServiceError',
            code: 'ATTRIBUTE_HAS_CATEGORY_DEPENDENCIES',
            statusCode: 409,
        });
    });

});
