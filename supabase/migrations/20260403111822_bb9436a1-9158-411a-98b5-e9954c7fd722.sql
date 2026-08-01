CREATE OR REPLACE FUNCTION public.decrement_stock_on_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _product RECORD;
  _seller_user_id uuid;
BEGIN
  UPDATE products
  SET stock_quantity = GREATEST(stock_quantity - NEW.quantity, 0)
  WHERE id = NEW.product_id AND stock_quantity IS NOT NULL
  RETURNING id, name, stock_quantity, low_stock_threshold, seller_id
  INTO _product;

  IF _product IS NULL THEN RETURN NEW; END IF;

  IF _product.stock_quantity <= 0 THEN
    UPDATE products SET is_available = false WHERE id = _product.id;
  END IF;

  IF _product.low_stock_threshold IS NOT NULL AND _product.stock_quantity <= _product.low_stock_threshold THEN
    SELECT user_id INTO _seller_user_id
    FROM seller_profiles WHERE id = _product.seller_id;

    IF _seller_user_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM notification_queue
        WHERE user_id = _seller_user_id
          AND type = 'low_stock'
          AND (payload->>'product_id') = _product.id::text
          AND created_at > now() - interval '24 hours'
      ) THEN
        INSERT INTO notification_queue
          (user_id, type, title, body, reference_path, payload)
        VALUES (
          _seller_user_id,
          'low_stock',
          CASE WHEN _product.stock_quantity <= 0
            THEN '🚨 Out of Stock: ' || _product.name
            ELSE '⚠️ Low Stock: ' || _product.name
          END,
          CASE WHEN _product.stock_quantity <= 0
            THEN _product.name || ' is now out of stock and has been marked unavailable.'
            ELSE _product.name || ' has only ' || _product.stock_quantity || ' units left (threshold: ' || _product.low_stock_threshold || ').'
          END,
          '/seller/products',
          jsonb_build_object(
            'product_id', _product.id,
            'product_name', _product.name,
            'stock_quantity', _product.stock_quantity,
            'threshold', _product.low_stock_threshold
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;