-- Repaired migration: retains only functions and triggers not yet applied.
-- Previously applied schema changes and redundant value_count checks were removed.

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