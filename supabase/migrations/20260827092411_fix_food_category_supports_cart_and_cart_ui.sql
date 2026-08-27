-- Food/beverage categories with self_fulfillment were misconfigured as
-- supports_cart=false while products keep action_type=add_to_cart.
-- UI showed Add to Cart / success feedback; DB trigger then rejected the insert.

UPDATE public.category_config
SET supports_cart = true,
    updated_at = now()
WHERE category IN ('other-food_beverages', 'other-food')
  AND supports_cart IS DISTINCT FROM true
  AND COALESCE(enquiry_only, false) = false
  AND transaction_type IN ('self_fulfillment', 'cart_purchase', 'seller_delivery');
