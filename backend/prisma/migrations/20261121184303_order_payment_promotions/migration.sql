-- Corrected migration for Order, Payment, and Promotions.
-- Reviewed against the supplied schema.prisma and previous migrations.
-- The coupon threshold column is renamed (not dropped/recreated), and the
-- legacy coupon_redemptions_amount_check is replaced before adding its new definition.

-- CreateEnum
CREATE TYPE "product_discount_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('CUSTOMER', 'ADMIN', 'POS');

-- CreateEnum
CREATE TYPE "fulfillment_type" AS ENUM ('SHIP', 'PICKUP', 'IN_STORE');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'POS', 'ONLINE');

-- CreateEnum
CREATE TYPE "special_offer_discount_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- DropForeignKey
ALTER TABLE "product_attribute_values" DROP CONSTRAINT "product_attribute_values_category_attribute_id_fkey";

-- DropForeignKey
ALTER TABLE "product_attribute_values" DROP CONSTRAINT "product_attribute_values_option_id_fkey";

-- DropForeignKey
ALTER TABLE "variant_attribute_values" DROP CONSTRAINT "variant_attribute_values_category_attribute_id_fkey";

-- DropForeignKey
ALTER TABLE "variant_attribute_values" DROP CONSTRAINT "variant_attribute_values_option_id_fkey";

-- DropIndex
DROP INDEX "payments_order_id_idx";

-- AlterTable
ALTER TABLE "coupon_redemptions" ADD COLUMN     "coupon_code_snapshot" VARCHAR(50) NOT NULL,
ADD COLUMN     "discount_amount_snapshot" BIGINT,
ADD COLUMN     "discount_percent_snapshot" DECIMAL(5,2),
ADD COLUMN     "discount_type_snapshot" "coupon_type" NOT NULL,
ADD COLUMN     "eligible_subtotal_rial" BIGINT NOT NULL,
ALTER COLUMN "customer_id" DROP NOT NULL;

-- Preserve the existing coupon threshold while changing its meaning/name.
ALTER TABLE "coupons"
RENAME COLUMN "minimum_order_amount_rial" TO "minimum_eligible_amount_rial";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "coupon_discount_amount_rial" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "special_offer_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "coupon_discount_rial" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "created_by_admin_id" UUID,
ADD COLUMN     "fulfillment_type" "fulfillment_type" NOT NULL DEFAULT 'SHIP',
ADD COLUMN     "guest_customer_name" VARCHAR(200),
ADD COLUMN     "guest_customer_phone" VARCHAR(16),
ADD COLUMN     "item_discount_total_rial" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "source" "order_source" NOT NULL DEFAULT 'CUSTOMER',
ALTER COLUMN "customer_id" DROP NOT NULL,
ALTER COLUMN "shipping_address_snapshot" DROP NOT NULL,
ALTER COLUMN "billing_address_snapshot" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "card_last_four" VARCHAR(4),
ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "confirmed_by_admin_id" UUID,
ADD COLUMN     "method" "payment_method" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "recorded_by_admin_id" UUID,
ADD COLUMN     "reference_code" VARCHAR(150);

-- AlterTable
ALTER TABLE "product_attribute_values" ADD COLUMN     "attribute_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "discount_amount_rial" BIGINT,
ADD COLUMN     "discount_ends_at" TIMESTAMPTZ(6),
ADD COLUMN     "discount_percent" DECIMAL(5,2),
ADD COLUMN     "discount_starts_at" TIMESTAMPTZ(6),
ADD COLUMN     "discount_type" "product_discount_type",
ADD COLUMN     "is_discount_active" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "created_by_admin_id" UUID,
ADD COLUMN     "processed_by_admin_id" UUID,
ALTER COLUMN "payment_attempt_id" DROP NOT NULL,
ALTER COLUMN "return_request_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "variant_attribute_values" ADD COLUMN     "attribute_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "special_offers" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "discount_type" "special_offer_discount_type" NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "discount_amount_rial" BIGINT,
    "max_quantity_per_order" INTEGER NOT NULL,
    "max_quantity_per_customer" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "special_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "special_offers_variant_id_is_active_starts_at_ends_at_idx" ON "special_offers"("variant_id", "is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "special_offers_id_variant_id_key" ON "special_offers"("id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_options_id_attribute_id_key" ON "attribute_options"("id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_attributes_id_attribute_id_key" ON "category_attributes"("id", "attribute_id");

-- CreateIndex
CREATE INDEX "orders_created_by_admin_id_created_at_idx" ON "orders"("created_by_admin_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_order_id_idx" ON "refunds"("payment_id", "order_id");

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_category_attribute_id_attribute_i_fkey" FOREIGN KEY ("category_attribute_id", "attribute_id") REFERENCES "category_attributes"("id", "attribute_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_option_id_attribute_id_fkey" FOREIGN KEY ("option_id", "attribute_id") REFERENCES "attribute_options"("id", "attribute_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_category_attribute_id_attribute_i_fkey" FOREIGN KEY ("category_attribute_id", "attribute_id") REFERENCES "category_attributes"("id", "attribute_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_option_id_attribute_id_fkey" FOREIGN KEY ("option_id", "attribute_id") REFERENCES "attribute_options"("id", "attribute_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_special_offer_id_variant_id_fkey" FOREIGN KEY ("special_offer_id", "variant_id") REFERENCES "special_offers"("id", "variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_admin_id_fkey" FOREIGN KEY ("recorded_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_admin_id_fkey" FOREIGN KEY ("confirmed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_order_id_fkey" FOREIGN KEY ("payment_id", "order_id") REFERENCES "payments"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_by_admin_id_fkey" FOREIGN KEY ("processed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_offers" ADD CONSTRAINT "special_offers_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "category_brands_brand_category_idx" RENAME TO "category_brands_brand_id_category_id_idx";

-- RenameIndex
ALTER INDEX "product_attribute_value_options_option_idx" RENAME TO "product_attribute_value_options_option_id_idx";

-- RenameIndex
ALTER INDEX "product_attribute_values_product_idx" RENAME TO "product_attribute_values_product_id_idx";

-- RenameIndex
ALTER INDEX "variant_attribute_value_options_option_idx" RENAME TO "variant_attribute_value_options_option_id_idx";

-- RenameIndex
ALTER INDEX "variant_attribute_values_variant_idx" RENAME TO "variant_attribute_values_variant_id_idx";

-- =========================================================
-- 11. Admin Refresh Token Constraints
-- =========================================================

-- Only one unused refresh token is allowed per session.
CREATE UNIQUE INDEX admin_refresh_tokens_one_unused_per_session
ON admin_refresh_tokens (session_id)
WHERE used_at IS NULL;

-- =========================================================
-- Start of custom constraints for Order & Payment Management
-- =========================================================
-- Matching the order source and delivery type
ALTER TABLE orders
ADD CONSTRAINT chk_orders_source_fulfillment
CHECK (
    (source = 'CUSTOMER' AND fulfillment_type = 'SHIP')
    OR
    (source = 'ADMIN' AND fulfillment_type = 'PICKUP')
    OR
    (source = 'POS' AND fulfillment_type = 'IN_STORE')
);
-- Requirement for the client to place a website order
ALTER TABLE orders
ADD CONSTRAINT chk_orders_customer_source
CHECK (
    source <> 'CUSTOMER'
    OR customer_id IS NOT NULL
);
-- Admin is mandatory for ADMIN and POS orders.
ALTER TABLE orders
ADD CONSTRAINT chk_orders_admin_source
CHECK (
    source = 'CUSTOMER'
    OR created_by_admin_id IS NOT NULL
);
-- Requirement of a shipping address for online orders
ALTER TABLE orders
ADD CONSTRAINT chk_orders_shipping_address
CHECK (
    fulfillment_type <> 'SHIP'
    OR shipping_address_snapshot IS NOT NULL
);


-- A manual payment must have a recording admin
ALTER TABLE payments
ADD CONSTRAINT chk_payments_manual_recorder
CHECK (
    method = 'ONLINE'
    OR recorded_by_admin_id IS NOT NULL
);
-- A successful manual payment must include a confirmation and a confirmation timestamp.
ALTER TABLE payments
ADD CONSTRAINT chk_payments_manual_confirmation
CHECK (
    method = 'ONLINE'
    OR status <> 'SUCCEEDED'
    OR (
        confirmed_by_admin_id IS NOT NULL
        AND confirmed_at IS NOT NULL
        AND paid_at IS NOT NULL
    )
);
-- 
ALTER TABLE refunds
ADD CONSTRAINT chk_refunds_processed_at
CHECK (
    status <> 'SUCCEEDED'
    OR processed_at IS NOT NULL
);
--
ALTER TABLE product_variants
ADD CONSTRAINT product_variants_discount_config_check
CHECK (
    (
        discount_type IS NULL
        AND discount_percent IS NULL
        AND discount_amount_rial IS NULL
    )
    OR
    (
        discount_type = 'PERCENTAGE'
        AND discount_percent IS NOT NULL
        AND discount_percent > 0
        AND discount_percent <= 100
        AND discount_amount_rial IS NULL
    )
    OR
    (
        discount_type = 'FIXED_AMOUNT'
        AND discount_amount_rial IS NOT NULL
        AND discount_amount_rial > 0
        AND discount_percent IS NULL
    )
);
--
ALTER TABLE product_variants
ADD CONSTRAINT product_variants_discount_dates_check
CHECK (
    (discount_starts_at IS NULL AND discount_ends_at IS NULL)
    OR
    (
        discount_starts_at IS NOT NULL
        AND discount_ends_at IS NOT NULL
        AND discount_ends_at > discount_starts_at
    )
);
--
ALTER TABLE product_variants
ADD CONSTRAINT product_variants_active_discount_check
CHECK (
    NOT is_discount_active
    OR (
        discount_type IS NOT NULL
        AND discount_starts_at IS NOT NULL
        AND discount_ends_at IS NOT NULL
    )
);
--
ALTER TABLE special_offers
ADD CONSTRAINT special_offers_discount_config_check
CHECK (
    (
        discount_type = 'PERCENTAGE'
        AND discount_percent IS NOT NULL
        AND discount_percent > 0
        AND discount_percent <= 100
        AND discount_amount_rial IS NULL
    )
    OR
    (
        discount_type = 'FIXED_AMOUNT'
        AND discount_amount_rial IS NOT NULL
        AND discount_amount_rial > 0
        AND discount_percent IS NULL
    )
);
--
ALTER TABLE special_offers
ADD CONSTRAINT special_offers_limits_check
CHECK (
    max_quantity_per_order > 0
    AND max_quantity_per_customer > 0
    AND ends_at > starts_at
);
--
ALTER TABLE orders
ADD CONSTRAINT orders_discount_breakdown_check
CHECK (
    subtotal_rial >= 0
    AND item_discount_total_rial >= 0
    AND coupon_discount_rial >= 0
    AND discount_total_rial >= 0
    AND discount_total_rial =
        item_discount_total_rial + coupon_discount_rial
    AND discount_total_rial <= subtotal_rial
);
-- Reconciling the final amount with the order components
ALTER TABLE orders
ADD CONSTRAINT orders_grand_total_check
CHECK (
    grand_total_rial =
        subtotal_rial
        - discount_total_rial
        + shipping_cost_rial
        + tax_total_rial
);
--
ALTER TABLE order_items
ADD CONSTRAINT order_items_discount_breakdown_check
CHECK (
    quantity > 0
    AND unit_price_rial >= 0
    AND discount_amount_rial >= 0
    AND coupon_discount_amount_rial >= 0
    AND discount_amount_rial + coupon_discount_amount_rial
        <= unit_price_rial * quantity
    AND total_price_rial =
        unit_price_rial * quantity
        - discount_amount_rial
        - coupon_discount_amount_rial
);
-- Replace the legacy non-negative-only check with the stricter redemption rule.
ALTER TABLE coupon_redemptions
DROP CONSTRAINT IF EXISTS coupon_redemptions_amount_check;

ALTER TABLE coupon_redemptions
ADD CONSTRAINT coupon_redemptions_amount_check
CHECK (
    discount_amount_rial > 0
    AND eligible_subtotal_rial > 0
);

-- Enable required PostgreSQL extension
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Prevent overlapping active special offers for the same variant
ALTER TABLE "special_offers"
ADD CONSTRAINT "special_offers_no_overlapping_periods"
EXCLUDE USING GIST (
    "variant_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
)
WHERE (is_active = TRUE);
