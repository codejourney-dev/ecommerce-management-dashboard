/*
  Warnings:

  - You are about to drop the column `attributes` on the `product_variants` table. All the data in the column will be lost.
  - You are about to drop the column `brand` on the `products` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "attribute_input_type" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN', 'DATE');

-- CreateEnum
CREATE TYPE "attribute_scope" AS ENUM ('PRODUCT', 'VARIANT');

-- AlterTable
ALTER TABLE "product_variants" DROP COLUMN "attributes";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "brand",
ADD COLUMN     "brand_id" UUID;

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_brands" (
    "category_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,

    CONSTRAINT "category_brands_pkey" PRIMARY KEY ("category_id","brand_id")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "input_type" "attribute_input_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_options" (
    "id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "value" VARCHAR(150) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attribute_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "scope" "attribute_scope" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_values" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "category_attribute_id" UUID NOT NULL,
    "text_value" TEXT,
    "number_value" DECIMAL(18,4),
    "boolean_value" BOOLEAN,
    "date_value" DATE,
    "option_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_attribute_values" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "category_attribute_id" UUID NOT NULL,
    "text_value" TEXT,
    "number_value" DECIMAL(18,4),
    "boolean_value" BOOLEAN,
    "date_value" DATE,
    "option_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "variant_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_value_options" (
    "product_attribute_value_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "product_attribute_value_options_pkey" PRIMARY KEY ("product_attribute_value_id","option_id")
);

-- CreateTable
CREATE TABLE "variant_attribute_value_options" (
    "variant_attribute_value_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "variant_attribute_value_options_pkey" PRIMARY KEY ("variant_attribute_value_id","option_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_slug_key" ON "attributes"("slug");

-- CreateIndex
CREATE INDEX "attribute_options_attribute_id_position_idx" ON "attribute_options"("attribute_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_options_attribute_id_value_key" ON "attribute_options"("attribute_id", "value");

-- CreateIndex
CREATE INDEX "category_attributes_category_id_position_idx" ON "category_attributes"("category_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "category_attributes_category_id_attribute_id_key" ON "category_attributes"("category_id", "attribute_id");

-- CreateIndex
CREATE INDEX "product_attribute_values_category_attribute_id_idx" ON "product_attribute_values"("category_attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_values_product_id_category_attribute_id_key" ON "product_attribute_values"("product_id", "category_attribute_id");

-- CreateIndex
CREATE INDEX "variant_attribute_values_category_attribute_id_idx" ON "variant_attribute_values"("category_attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_attribute_values_variant_id_category_attribute_id_key" ON "variant_attribute_values"("variant_id", "category_attribute_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_brands" ADD CONSTRAINT "category_brands_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_brands" ADD CONSTRAINT "category_brands_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_category_attribute_id_fkey" FOREIGN KEY ("category_attribute_id") REFERENCES "category_attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "attribute_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_category_attribute_id_fkey" FOREIGN KEY ("category_attribute_id") REFERENCES "category_attributes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "attribute_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_value_options" ADD CONSTRAINT "product_attribute_value_options_product_attribute_value_id_fkey" FOREIGN KEY ("product_attribute_value_id") REFERENCES "product_attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_value_options" ADD CONSTRAINT "product_attribute_value_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "attribute_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_value_options" ADD CONSTRAINT "variant_attribute_value_options_variant_attribute_value_id_fkey" FOREIGN KEY ("variant_attribute_value_id") REFERENCES "variant_attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_value_options" ADD CONSTRAINT "variant_attribute_value_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "attribute_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =========================================
-- Catalog: Category and Brand constraints
-- =========================================

-- A brand can be assigned to a category only once.
-- Already enforced by CategoryBrand composite primary key.

-- =========================================
-- Catalog: Attribute constraints
-- =========================================

-- Attribute option ordering cannot be negative.
ALTER TABLE attribute_options
ADD CONSTRAINT attribute_options_position_check
CHECK (position >= 0);

-- Category attribute ordering cannot be negative.
ALTER TABLE category_attributes
ADD CONSTRAINT category_attributes_position_check
CHECK (position >= 0);

-- =========================================
-- Catalog: Attribute value constraints
-- =========================================

-- A single-value attribute must contain at most one value.
-- MULTI_SELECT values are stored in their selection tables,
-- so the parent value row must have all typed fields NULL.

ALTER TABLE product_attribute_values
ADD CONSTRAINT product_attribute_values_single_value_check
CHECK (
  num_nonnulls(
    text_value,
    number_value,
    boolean_value,
    date_value,
    option_id
  ) <= 1
);

ALTER TABLE variant_attribute_values
ADD CONSTRAINT variant_attribute_values_single_value_check
CHECK (
  num_nonnulls(
    text_value,
    number_value,
    boolean_value,
    date_value,
    option_id
  ) <= 1
);

-- =========================================
-- Catalog: Useful indexes
-- =========================================

CREATE INDEX category_brands_brand_category_idx
ON category_brands (brand_id, category_id);

CREATE INDEX product_attribute_values_product_idx
ON product_attribute_values (product_id);

CREATE INDEX variant_attribute_values_variant_idx
ON variant_attribute_values (variant_id);

CREATE INDEX product_attribute_value_options_option_idx
ON product_attribute_value_options (option_id);

CREATE INDEX variant_attribute_value_options_option_idx
ON variant_attribute_value_options (option_id);
