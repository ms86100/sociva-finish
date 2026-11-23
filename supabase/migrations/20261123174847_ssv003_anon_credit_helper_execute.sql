-- Products SELECT calls seller_credit_activation_satisfied. Same RLS pitfall as is_admin.
GRANT EXECUTE ON FUNCTION public.seller_credit_activation_satisfied(uuid) TO anon;
