-- =========================================================
-- PostgreSQL-specific constraints, triggers, and indexes.
--
-- This file is the consolidated reference for custom
-- database rules that are not fully represented by Prisma.
--
-- Apply only newly introduced rules in their corresponding
-- migrations. Do not execute this entire file repeatedly.
--
-- Prerequisites:
-- - Tables and columns are created by Prisma migrations.
-- - Composite unique constraints on
--   (id, attribute_id) are defined in Prisma Schema.
-- - attribute_id columns are defined in Prisma Schema.
-- =========================================================

-- =========================================================
-- 1. Customer Address Constraints
-- =========================================================

-- A customer can have at most one default address.
CREATE UNIQUE INDEX one_default_address_per_customer
ON customer_addresses (customer_id)
WHERE is_default = TRUE;

-- =========================================================
-- 2. Product Image Constraints
-- =========================================================

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

-- =========================================================
-- 3. Inventory Constraints
-- =========================================================

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

-- =========================================================
-- 4. Order, Shipment, and Return Constraints
-- =========================================================

-- Order line and shipment quantities must be positive.
ALTER TABLE order_items
ADD CONSTRAINT order_items_quantity_check
CHECK (quantity > 0);

ALTER TABLE shipment_items
ADD CONSTRAINT shipment_items_quantity_check
CHECK (quantity > 0);

-- Return quantities can be zero before approval,
-- receipt, or inspection.
-- Each stage cannot exceed the preceding stage.

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


-- =========================================================
-- 5. Review Constraints
-- =========================================================

-- Reviews are rated from 1 to 5.
ALTER TABLE reviews
ADD CONSTRAINT reviews_rating_check
CHECK (rating BETWEEN 1 AND 5);


-- =========================================================
-- 6. Product Variant Price Constraints
-- =========================================================

-- Product variant prices cannot be negative.
ALTER TABLE product_variants
ADD CONSTRAINT product_variants_price_check
CHECK (
    price_rial >= 0
    AND (cost_price_rial IS NULL OR cost_price_rial >= 0)
    AND (compare_at_price_rial IS NULL OR compare_at_price_rial >= 0)
);

-- =========================================================
-- 7. Payment Constraints
-- =========================================================

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

-- =========================================================
-- 8. Coupon Constraints
-- =========================================================

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
    minimum_eligible_amount_rial >= 0
    AND (maximum_discount_rial IS NULL OR maximum_discount_rial > 0)
    AND (usage_limit IS NULL OR usage_limit > 0)
    AND usage_per_customer >= 1
    AND expires_at > starts_at
);
-- Control of financial amounts
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

-- =========================================================
-- 9. OTP Constraints
-- =========================================================

-- OTP attempt counters are non-negative and cannot exceed
-- their configured limits.
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

-- =========================================================
-- 10. Store Settings Constraints
-- =========================================================

-- Store settings are a singleton record for this
-- single-store application.
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

-- =========================================================
-- 11. Admin Refresh Token Constraints
-- =========================================================

-- Only one unused refresh token is allowed per session.
CREATE UNIQUE INDEX admin_refresh_tokens_one_unused_per_session
ON admin_refresh_tokens (session_id)
WHERE used_at IS NULL;

-- =========================================================
-- 12. Catalog: Category and Brand Constraints
-- =========================================================

-- A brand can be assigned to a category only once.
-- This is already enforced by the CategoryBrand
-- composite primary key in Prisma Schema.

-- =========================================================
-- 13. Catalog: Attribute Constraints
-- =========================================================

-- Attribute option ordering cannot be negative.
ALTER TABLE attribute_options
ADD CONSTRAINT attribute_options_position_check
CHECK (position >= 0);

-- Category attribute ordering cannot be negative.
ALTER TABLE category_attributes
ADD CONSTRAINT category_attributes_position_check
CHECK (position >= 0);


-- =========================================================
-- 14. Catalog: Attribute Value Constraints
-- =========================================================

-- A single-value attribute must contain at most one
-- scalar value.
--
-- MULTI_SELECT values are stored in their selection tables.
-- Therefore, all scalar fields in their parent value row
-- must be NULL.

ALTER TABLE product_attribute_values
ADD CONSTRAINT product_attribute_values_value_count_check
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
ADD CONSTRAINT variant_attribute_values_value_count_check
CHECK (
    num_nonnulls(
        text_value,
        number_value,
        boolean_value,
        date_value,
        option_id
    ) <= 1
);

-- =========================================================
-- 15. Catalog: Attribute Value Validation
-- =========================================================

-- Validates:
-- 1. CategoryAttribute existence.
-- 2. Attribute and CategoryAttribute consistency.
-- 3. PRODUCT / VARIANT scope.
-- 4. Input type and corresponding scalar field.
-- 5. SELECT option existence, ownership, and active status.
-- 6. MULTI_SELECT scalar fields must all be NULL.

CREATE OR REPLACE FUNCTION validate_attribute_value()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_input_type attribute_input_type;
    v_scope attribute_scope;
    v_option_active BOOLEAN;
BEGIN
    SELECT a.input_type, ca.scope
    INTO v_input_type, v_scope
    FROM category_attributes ca
    JOIN attributes a
        ON a.id = ca.attribute_id
    WHERE ca.id = NEW.category_attribute_id
      AND ca.attribute_id = NEW.attribute_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid category attribute';
    END IF;

    -- Product values must use PRODUCT-scoped attributes.

    IF TG_TABLE_NAME = 'product_attribute_values'
       AND v_scope <> 'PRODUCT' THEN
        RAISE EXCEPTION 'Attribute scope must be PRODUCT';
    END IF;

    -- Variant values must use VARIANT-scoped attributes.

    IF TG_TABLE_NAME = 'variant_attribute_values'
       AND v_scope <> 'VARIANT' THEN
        RAISE EXCEPTION 'Attribute scope must be VARIANT';
    END IF;

    CASE v_input_type

        WHEN 'TEXT' THEN
            IF NEW.text_value IS NULL
               OR num_nonnulls(
                   NEW.number_value,
                   NEW.boolean_value,
                   NEW.date_value,
                   NEW.option_id
               ) <> 0 THEN
                RAISE EXCEPTION 'Invalid TEXT attribute value';
            END IF;

        WHEN 'NUMBER' THEN
            IF NEW.number_value IS NULL
               OR num_nonnulls(
                   NEW.text_value,
                   NEW.boolean_value,
                   NEW.date_value,
                   NEW.option_id
               ) <> 0 THEN
                RAISE EXCEPTION 'Invalid NUMBER attribute value';
            END IF;

        WHEN 'BOOLEAN' THEN
            IF NEW.boolean_value IS NULL
               OR num_nonnulls(
                   NEW.text_value,
                   NEW.number_value,
                   NEW.date_value,
                   NEW.option_id
               ) <> 0 THEN
                RAISE EXCEPTION 'Invalid BOOLEAN attribute value';
            END IF;

        WHEN 'DATE' THEN
            IF NEW.date_value IS NULL
               OR num_nonnulls(
                   NEW.text_value,
                   NEW.number_value,
                   NEW.boolean_value,
                   NEW.option_id
               ) <> 0 THEN
                RAISE EXCEPTION 'Invalid DATE attribute value';
            END IF;

        WHEN 'SELECT' THEN
            IF NEW.option_id IS NULL
               OR num_nonnulls(
                   NEW.text_value,
                   NEW.number_value,
                   NEW.boolean_value,
                   NEW.date_value
               ) <> 0 THEN
                RAISE EXCEPTION 'Invalid SELECT attribute value';
            END IF;

            -- The selected option must exist, belong to the
            -- same Attribute, and be active.

            SELECT is_active
            INTO v_option_active
            FROM attribute_options
            WHERE id = NEW.option_id
              AND attribute_id = NEW.attribute_id;

            IF NOT FOUND OR NOT v_option_active THEN
                RAISE EXCEPTION
                    'SELECT requires an active option belonging to the attribute';
            END IF;

        WHEN 'MULTI_SELECT' THEN
            IF num_nonnulls(
                NEW.text_value,
                NEW.number_value,
                NEW.boolean_value,
                NEW.date_value,
                NEW.option_id
            ) <> 0 THEN
                RAISE EXCEPTION
                    'MULTI_SELECT cannot use scalar values';
            END IF;

    END CASE;

    RETURN NEW;
END;
$$;

-- Product attribute value validation trigger.
CREATE TRIGGER product_attribute_value_validate
BEFORE INSERT OR UPDATE
ON product_attribute_values
FOR EACH ROW
EXECUTE FUNCTION validate_attribute_value();

-- Variant attribute value validation trigger.
CREATE TRIGGER variant_attribute_value_validate
BEFORE INSERT OR UPDATE
ON variant_attribute_values
FOR EACH ROW
EXECUTE FUNCTION validate_attribute_value();

-- =========================================================
-- 16. Catalog: MULTI_SELECT Option Validation
-- =========================================================

-- Ensures that:
-- 1. The parent attribute value exists.
-- 2. The parent Attribute is MULTI_SELECT.
-- 3. The selected option belongs to the same Attribute.
-- 4. The selected option is active.

CREATE OR REPLACE FUNCTION validate_multi_select_option()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_attribute_id UUID;
    v_input_type attribute_input_type;
    v_option_attribute_id UUID;
    v_option_active BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'product_attribute_value_options' THEN
        SELECT pav.attribute_id, a.input_type
        INTO v_attribute_id, v_input_type
        FROM product_attribute_values pav
        JOIN attributes a
            ON a.id = pav.attribute_id
        WHERE pav.id = NEW.product_attribute_value_id;
    ELSE
        SELECT vav.attribute_id, a.input_type
        INTO v_attribute_id, v_input_type
        FROM variant_attribute_values vav
        JOIN attributes a
            ON a.id = vav.attribute_id
        WHERE vav.id = NEW.variant_attribute_value_id;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attribute value record not found';
    END IF;

    IF v_input_type <> 'MULTI_SELECT' THEN
        RAISE EXCEPTION
            'Selection rows are allowed only for MULTI_SELECT attributes';
    END IF;

    SELECT attribute_id, is_active
    INTO v_option_attribute_id, v_option_active
    FROM attribute_options
    WHERE id = NEW.option_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attribute option not found';
    END IF;

    IF v_option_attribute_id <> v_attribute_id THEN
        RAISE EXCEPTION
            'Option does not belong to this attribute';
    END IF;

    IF NOT v_option_active THEN
        RAISE EXCEPTION
            'Inactive option cannot be selected';
    END IF;

    RETURN NEW;
END;
$$;


CREATE TRIGGER product_multi_select_validate
BEFORE INSERT OR UPDATE
ON product_attribute_value_options
FOR EACH ROW
EXECUTE FUNCTION validate_multi_select_option();


CREATE TRIGGER variant_multi_select_validate
BEFORE INSERT OR UPDATE
ON variant_attribute_value_options
FOR EACH ROW
EXECUTE FUNCTION validate_multi_select_option();


-- =========================================================
-- 17. Catalog: MULTI_SELECT Minimum Selection Rule
-- =========================================================

-- Business rule:
--
-- If a MULTI_SELECT parent value row exists, it must have
-- at least one selected option at transaction commit.
--
-- If an optional MULTI_SELECT attribute is not provided,
-- its parent value row should not be created.
--
-- These checks are deferred because the parent row and
-- its selected options are normally inserted in the
-- same transaction.


-- Checks a MULTI_SELECT parent value row.
--
-- The function is shared by product and variant values.

CREATE OR REPLACE FUNCTION assert_multi_select_has_option(
    p_parent_table TEXT,
    p_parent_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_attribute_id UUID;
    v_input_type attribute_input_type;
    v_option_count BIGINT;
BEGIN
    IF p_parent_table = 'product_attribute_values' THEN
        SELECT attribute_id
        INTO v_attribute_id
        FROM product_attribute_values
        WHERE id = p_parent_id;

        IF NOT FOUND THEN
            RETURN;
        END IF;

        SELECT input_type
        INTO v_input_type
        FROM attributes
        WHERE id = v_attribute_id;

        SELECT COUNT(*)
        INTO v_option_count
        FROM product_attribute_value_options
        WHERE product_attribute_value_id = p_parent_id;

    ELSIF p_parent_table = 'variant_attribute_values' THEN

        SELECT attribute_id
        INTO v_attribute_id
        FROM variant_attribute_values
        WHERE id = p_parent_id;

        IF NOT FOUND THEN
            RETURN;
        END IF;

        SELECT input_type
        INTO v_input_type
        FROM attributes
        WHERE id = v_attribute_id;

        SELECT COUNT(*)
        INTO v_option_count
        FROM variant_attribute_value_options
        WHERE variant_attribute_value_id = p_parent_id;

    ELSE

        RAISE EXCEPTION
            'Unsupported attribute value table: %',
            p_parent_table;

    END IF;

    IF v_input_type = 'MULTI_SELECT'
       AND v_option_count = 0 THEN

        RAISE EXCEPTION
            'MULTI_SELECT attribute value must have at least one selected option';

    END IF;

END;
$$;

-- Deferred check for product and variant parent rows.
CREATE OR REPLACE FUNCTION check_multi_select_parent_value()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM assert_multi_select_has_option(
        TG_TABLE_NAME,
        NEW.id
    );
    RETURN NULL;
END;
$$;


CREATE CONSTRAINT TRIGGER product_multi_select_minimum_selection
AFTER INSERT OR UPDATE
ON product_attribute_values
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_multi_select_parent_value();


CREATE CONSTRAINT TRIGGER variant_multi_select_minimum_selection
AFTER INSERT OR UPDATE
ON variant_attribute_values
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_multi_select_parent_value();


-- Deferred check after deleting or moving selected options.
--
-- The old parent must still have at least one selection
-- if it still exists and is MULTI_SELECT.
--
-- The new parent is also checked when an option is moved
-- to another parent value row.

CREATE OR REPLACE FUNCTION check_multi_select_child_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_parent_id UUID;
    v_new_parent_id UUID;
    v_parent_table TEXT;
BEGIN
    IF TG_TABLE_NAME = 'product_attribute_value_options' THEN
        v_parent_table := 'product_attribute_values';
        IF TG_OP <> 'INSERT' THEN
            v_old_parent_id := OLD.product_attribute_value_id;
        END IF;

        IF TG_OP <> 'DELETE' THEN
            v_new_parent_id := NEW.product_attribute_value_id;
        END IF;

    ELSIF TG_TABLE_NAME = 'variant_attribute_value_options' THEN
        v_parent_table := 'variant_attribute_values';
        IF TG_OP <> 'INSERT' THEN
            v_old_parent_id := OLD.variant_attribute_value_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            v_new_parent_id := NEW.variant_attribute_value_id;
        END IF;
    ELSE
        RAISE EXCEPTION
            'Unsupported selection table: %',
            TG_TABLE_NAME;
    END IF;

    IF v_old_parent_id IS NOT NULL THEN
        PERFORM assert_multi_select_has_option(
            v_parent_table,
            v_old_parent_id
        );
    END IF;

    IF v_new_parent_id IS NOT NULL
       AND v_new_parent_id IS DISTINCT FROM v_old_parent_id THEN
        PERFORM assert_multi_select_has_option(
            v_parent_table,
            v_new_parent_id
        );
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER product_multi_select_child_minimum_selection
AFTER INSERT OR UPDATE OR DELETE
ON product_attribute_value_options
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_multi_select_child_changes();

CREATE CONSTRAINT TRIGGER variant_multi_select_child_minimum_selection
AFTER INSERT OR UPDATE OR DELETE
ON variant_attribute_value_options
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_multi_select_child_changes();

-- =========================================================
-- End of custom constraints
-- =========================================================

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
