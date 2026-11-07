-- PostgreSQL-specific constraints and partial indexes.
-- Apply this file inside the initial Prisma migration after the tables are created.

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
