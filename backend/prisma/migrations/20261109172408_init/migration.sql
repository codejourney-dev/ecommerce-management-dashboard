-- CreateEnum
CREATE TYPE "admin_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('LOGIN', 'PHONE_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('STOCKIN', 'STOCKOUT', 'RESERVATION', 'RESERVATION_RELEASE', 'ADJUSTMENT', 'RETURN');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_attempt_status" AS ENUM ('PENDING', 'INITIATED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "webhook_processing_status" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('PENDING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CUSTOMER_RETURN', 'DELIVERY_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "coupon_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "return_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITING_FOR_RETURN', 'RECEIVED', 'INSPECTING', 'PARTIALLY_APPROVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "return_request_reason" AS ENUM ('DAMAGED', 'DEFECTIVE', 'WRONG_PRODUCT', 'WRONG_VARIANT', 'NOT_AS_DESCRIBED', 'CUSTOMER_CHANGED_MIND', 'OTHER');

-- CreateEnum
CREATE TYPE "return_item_condition" AS ENUM ('UNOPENED', 'OPENED', 'DAMAGED', 'DEFECTIVE', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "return_shipment_status" AS ENUM ('PENDING', 'SHIPPED', 'INTRANSIT', 'DELIVERED', 'RECEIVED', 'LOST', 'CANCELLED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "avatar_url" TEXT,
    "status" "admin_status" NOT NULL DEFAULT 'PENDING',
    "phone_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_roles" (
    "admin_user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("admin_user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_otp_challenges" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "user_name" VARCHAR(20),
    "email" VARCHAR(255),
    "phone" VARCHAR(16) NOT NULL,
    "password_hash" TEXT,
    "phone_verified_at" TIMESTAMPTZ(6),
    "email_verified_at" TIMESTAMPTZ(6),
    "status" "customer_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provinces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "province_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "recipient_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "postal_code" VARCHAR(10) NOT NULL,
    "address_line" TEXT NOT NULL,
    "plaque" VARCHAR(20),
    "unit" VARCHAR(20),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_otp_challenges" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "brand" VARCHAR(150),
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "product_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("product_id","category_id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "attributes" JSONB NOT NULL,
    "price_rial" BIGINT NOT NULL,
    "compare_at_price_rial" BIGINT,
    "cost_price_rial" BIGINT,
    "barcode" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "image_url" TEXT NOT NULL,
    "alt_text" VARCHAR(255) NOT NULL,
    "position" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" VARCHAR(30) NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "subtotal_rial" BIGINT NOT NULL,
    "discount_total_rial" BIGINT NOT NULL,
    "shipping_cost_rial" BIGINT NOT NULL,
    "tax_total_rial" BIGINT NOT NULL,
    "grand_total_rial" BIGINT NOT NULL,
    "coupon_id" UUID,
    "customer_note" TEXT,
    "shipping_address_snapshot" JSONB NOT NULL,
    "billing_address_snapshot" JSONB NOT NULL,
    "placed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_name" VARCHAR(255) NOT NULL,
    "variant_title" VARCHAR(150) NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "unit_price_rial" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discount_amount_rial" BIGINT NOT NULL,
    "total_price_rial" BIGINT NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "old_status" "order_status",
    "new_status" "order_status" NOT NULL,
    "changed_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "address" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL,
    "quantity_reserved" INTEGER NOT NULL,
    "reorder_level" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "movement_type" "movement_type" NOT NULL DEFAULT 'STOCKIN',
    "quantity_delta" INTEGER NOT NULL,
    "reference_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID,
    "note" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_providers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "supports_refund" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount_rial" BIGINT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "provider_transaction_id" VARCHAR(150),
    "authority" VARCHAR(150),
    "amount_rial" BIGINT NOT NULL,
    "status" "payment_attempt_status" NOT NULL DEFAULT 'PENDING',
    "failure_code" VARCHAR(100),
    "failure_message" TEXT,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_event_id" VARCHAR(150) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_verified" BOOLEAN NOT NULL,
    "processing_status" "webhook_processing_status" NOT NULL DEFAULT 'RECEIVED',
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "amount_rial" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'PENDING',
    "transaction_id" VARCHAR(150),
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "carrier" VARCHAR(100) NOT NULL,
    "tracking_number" VARCHAR(150),
    "status" "shipment_status" NOT NULL DEFAULT 'PENDING',
    "shipped_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "discount_type" "coupon_type" NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "discount_amount_rial" BIGINT,
    "minimum_order_amount_rial" BIGINT NOT NULL,
    "maximum_discount_rial" BIGINT,
    "usage_limit" INTEGER,
    "usage_per_customer" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "discount_amount_rial" BIGINT NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "comment" TEXT NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(20) NOT NULL DEFAULT 'default',
    "store_name" VARCHAR(200) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL,
    "tax_enabled" BOOLEAN NOT NULL,
    "default_tax_rate" DECIMAL(5,2) NOT NULL,
    "low_stock_threshold" INTEGER NOT NULL,
    "support_contact_number" VARCHAR(16) NOT NULL,
    "store_email" VARCHAR(255) NOT NULL,
    "store_address" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "return_number" VARCHAR(30) NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "return_request_status" NOT NULL DEFAULT 'PENDING',
    "reason" "return_request_reason" NOT NULL,
    "customer_note" TEXT,
    "admin_note" TEXT,
    "requested_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "approved_quantity" INTEGER NOT NULL DEFAULT 0,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "accepted_quantity" INTEGER NOT NULL DEFAULT 0,
    "reason" "return_request_reason" NOT NULL,
    "condition" "return_item_condition",
    "reason_note" TEXT,
    "inspection_note" TEXT,
    "refund_amount_rial" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_shipments" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "carrier" VARCHAR(100) NOT NULL,
    "tracking_number" VARCHAR(150),
    "status" "return_shipment_status" NOT NULL DEFAULT 'PENDING',
    "shipped_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "return_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_shipment_items" (
    "id" UUID NOT NULL,
    "return_shipment_id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "return_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "return_shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_phone_key" ON "admin_users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE INDEX "admin_user_roles_role_id_idx" ON "admin_user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "admin_otp_challenges_admin_user_id_purpose_idx" ON "admin_otp_challenges"("admin_user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_refresh_token_hash_key" ON "admin_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_name_key" ON "customers"("user_name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_name_key" ON "provinces"("name");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_slug_key" ON "provinces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "cities_province_id_name_key" ON "cities"("province_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cities_province_id_slug_key" ON "cities"("province_id", "slug");

-- CreateIndex
CREATE INDEX "customer_otp_challenges_customer_id_purpose_idx" ON "customer_otp_challenges"("customer_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_refresh_token_hash_key" ON "customer_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_customer_id_idx" ON "customer_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "product_categories_category_id_idx" ON "product_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "product_variants"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_product_id_key" ON "product_variants"("id", "product_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_coupon_id_idx" ON "orders"("coupon_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_id_order_id_key" ON "order_items"("id", "order_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_variant_id_warehouse_id_key" ON "inventory"("variant_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_warehouse_id_created_at_idx" ON "inventory_movements"("variant_id", "warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_providers_code_key" ON "payment_providers"("code");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_order_id_key" ON "payments"("id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotency_key_key" ON "payment_attempts"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_attempts_payment_id_idx" ON "payment_attempts"("payment_id");

-- CreateIndex
CREATE INDEX "payment_attempts_provider_id_idx" ON "payment_attempts"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_id_payment_id_order_id_key" ON "payment_attempts"("id", "payment_id", "order_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_id_created_at_idx" ON "payment_webhook_events"("provider_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_id_external_event_id_key" ON "payment_webhook_events"("provider_id", "external_event_id");

-- CreateIndex
CREATE INDEX "refunds_payment_attempt_id_payment_id_order_id_idx" ON "refunds"("payment_attempt_id", "payment_id", "order_id");

-- CreateIndex
CREATE INDEX "refunds_return_request_id_order_id_idx" ON "refunds"("return_request_id", "order_id");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_id_order_id_key" ON "shipments"("id", "order_id");

-- CreateIndex
CREATE INDEX "shipment_items_order_item_id_order_id_idx" ON "shipment_items"("order_item_id", "order_id");

-- CreateIndex
CREATE INDEX "shipment_items_shipment_id_order_id_idx" ON "shipment_items"("shipment_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_shipment_id_order_item_id_key" ON "shipment_items"("shipment_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_customer_id_idx" ON "coupon_redemptions"("coupon_id", "customer_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews"("product_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_item_id_key" ON "reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "audit_logs_admin_user_id_created_at_idx" ON "audit_logs"("admin_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_settings_key_key" ON "store_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_return_number_key" ON "return_requests"("return_number");

-- CreateIndex
CREATE INDEX "return_requests_customer_id_created_at_idx" ON "return_requests"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "return_requests_order_id_idx" ON "return_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_id_order_id_key" ON "return_requests"("id", "order_id");

-- CreateIndex
CREATE INDEX "return_items_order_item_id_order_id_idx" ON "return_items"("order_item_id", "order_id");

-- CreateIndex
CREATE INDEX "return_items_return_request_id_order_id_idx" ON "return_items"("return_request_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_id_return_request_id_key" ON "return_items"("id", "return_request_id");

-- CreateIndex
CREATE INDEX "return_shipments_return_request_id_idx" ON "return_shipments"("return_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_shipments_id_return_request_id_key" ON "return_shipments"("id", "return_request_id");

-- CreateIndex
CREATE INDEX "return_shipment_items_return_item_id_return_request_id_idx" ON "return_shipment_items"("return_item_id", "return_request_id");

-- CreateIndex
CREATE INDEX "return_shipment_items_return_shipment_id_return_request_id_idx" ON "return_shipment_items"("return_shipment_id", "return_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_shipment_items_return_shipment_id_return_item_id_key" ON "return_shipment_items"("return_shipment_id", "return_item_id");

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_otp_challenges" ADD CONSTRAINT "admin_otp_challenges_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_otp_challenges" ADD CONSTRAINT "customer_otp_challenges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_order_id_fkey" FOREIGN KEY ("payment_id", "order_id") REFERENCES "payments"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_attempt_id_payment_id_order_id_fkey" FOREIGN KEY ("payment_attempt_id", "payment_id", "order_id") REFERENCES "payment_attempts"("id", "payment_id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_request_id_order_id_fkey" FOREIGN KEY ("return_request_id", "order_id") REFERENCES "return_requests"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_order_id_fkey" FOREIGN KEY ("shipment_id", "order_id") REFERENCES "shipments"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_order_id_fkey" FOREIGN KEY ("order_item_id", "order_id") REFERENCES "order_items"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_request_id_order_id_fkey" FOREIGN KEY ("return_request_id", "order_id") REFERENCES "return_requests"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_id_fkey" FOREIGN KEY ("order_item_id", "order_id") REFERENCES "order_items"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_shipments" ADD CONSTRAINT "return_shipments_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_shipment_items" ADD CONSTRAINT "return_shipment_items_return_shipment_id_return_request_id_fkey" FOREIGN KEY ("return_shipment_id", "return_request_id") REFERENCES "return_shipments"("id", "return_request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_shipment_items" ADD CONSTRAINT "return_shipment_items_return_item_id_return_request_id_fkey" FOREIGN KEY ("return_item_id", "return_request_id") REFERENCES "return_items"("id", "return_request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A customer can have at most one default address.
CREATE UNIQUE INDEX one_default_address_per_customer
ON customer_addresses (customer_id)
WHERE is_default = TRUE;

-- A product can have at most one primary product-level image.
CREATE UNIQUE INDEX one_primary_image_per_product
ON product_images (product_id)
WHERE is_primary = TRUE
  AND variant_id IS NULL;

-- A variant can have at most one primary variant-level image.
CREATE UNIQUE INDEX one_primary_image_per_variant
ON product_images (variant_id)
WHERE is_primary = TRUE
  AND variant_id IS NOT NULL;

-- Image positions are zero-based and cannot be negative.
ALTER TABLE product_images
ADD CONSTRAINT product_images_position_check
CHECK (position >= 0);

-- Inventory quantities must remain valid.
ALTER TABLE inventory
ADD CONSTRAINT inventory_quantity_check
CHECK (
  quantity_on_hand >= 0
  AND quantity_reserved >= 0
  AND quantity_reserved <= quantity_on_hand
);

ALTER TABLE inventory
ADD CONSTRAINT inventory_reorder_level_check
CHECK (reorder_level >= 0);

-- Order line and shipment quantities must be positive.
ALTER TABLE order_items
ADD CONSTRAINT order_items_quantity_check
CHECK (quantity > 0);

ALTER TABLE shipment_items
ADD CONSTRAINT shipment_items_quantity_check
CHECK (quantity > 0);

-- Return quantities can be zero before approval/receipt/inspection,
-- but each stage cannot exceed the preceding stage.
ALTER TABLE return_items
ADD CONSTRAINT return_items_quantity_check
CHECK (
  quantity > 0
  AND approved_quantity >= 0
  AND approved_quantity <= quantity
  AND received_quantity >= 0
  AND received_quantity <= approved_quantity
  AND accepted_quantity >= 0
  AND accepted_quantity <= received_quantity
  AND refund_amount_rial >= 0
);

ALTER TABLE return_shipment_items
ADD CONSTRAINT return_shipment_items_quantity_check
CHECK (quantity > 0);

-- Reviews are rated from 1 to 5.
ALTER TABLE reviews
ADD CONSTRAINT reviews_rating_check
CHECK (rating BETWEEN 1 AND 5);

-- Product variant prices cannot be negative.
ALTER TABLE product_variants
ADD CONSTRAINT product_variants_price_check
CHECK (
  price_rial >= 0
  AND (cost_price_rial IS NULL OR cost_price_rial >= 0)
  AND (compare_at_price_rial IS NULL OR compare_at_price_rial >= 0)
);

-- Monetary values on payment records must be positive.
ALTER TABLE payments
ADD CONSTRAINT payments_amount_check
CHECK (amount_rial > 0);

ALTER TABLE payment_attempts
ADD CONSTRAINT payment_attempts_amount_check
CHECK (amount_rial > 0);

ALTER TABLE refunds
ADD CONSTRAINT refunds_amount_check
CHECK (amount_rial > 0);

-- Coupon discount fields must match the selected discount type.
ALTER TABLE coupons
ADD CONSTRAINT coupon_discount_type_check
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

ALTER TABLE coupons
ADD CONSTRAINT coupons_limits_check
CHECK (
  minimum_order_amount_rial >= 0
  AND (maximum_discount_rial IS NULL OR maximum_discount_rial > 0)
  AND (usage_limit IS NULL OR usage_limit > 0)
  AND usage_per_customer >= 1
  AND expires_at > starts_at
);

-- Coupon redemption and order amounts cannot be negative.
ALTER TABLE coupon_redemptions
ADD CONSTRAINT coupon_redemptions_amount_check
CHECK (discount_amount_rial >= 0);

ALTER TABLE orders
ADD CONSTRAINT orders_amounts_check
CHECK (
  subtotal_rial >= 0
  AND discount_total_rial >= 0
  AND discount_total_rial <= subtotal_rial
  AND shipping_cost_rial >= 0
  AND tax_total_rial >= 0
  AND grand_total_rial >= 0
);

ALTER TABLE order_items
ADD CONSTRAINT order_items_amounts_check
CHECK (
  unit_price_rial >= 0
  AND discount_amount_rial >= 0
  AND total_price_rial >= 0
);

-- OTP attempt counters are non-negative and cannot exceed their limits.
ALTER TABLE admin_otp_challenges
ADD CONSTRAINT admin_otp_attempts_check
CHECK (
  attempts >= 0
  AND max_attempts > 0
  AND attempts <= max_attempts
);

ALTER TABLE customer_otp_challenges
ADD CONSTRAINT customer_otp_attempts_check
CHECK (
  attempts >= 0
  AND max_attempts > 0
  AND attempts <= max_attempts
);

-- Store settings are a singleton record for this single-store application.
ALTER TABLE store_settings
ADD CONSTRAINT store_settings_singleton_check
CHECK (key = 'default');

ALTER TABLE store_settings
ADD CONSTRAINT store_settings_values_check
CHECK (
  default_tax_rate >= 0
  AND default_tax_rate <= 100
  AND low_stock_threshold >= 0
);
