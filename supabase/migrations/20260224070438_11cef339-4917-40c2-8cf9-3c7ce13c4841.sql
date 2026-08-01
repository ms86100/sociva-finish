
-- Fix: Change view to use SECURITY INVOKER (default, but explicit)
DROP VIEW IF EXISTS public.transaction_audit_trail;
CREATE VIEW public.transaction_audit_trail
WITH (security_invoker = true)
AS
SELECT
  o.id AS order_id,
  o.created_at AS order_placed_at,
  o.status AS order_status,
  o.total_amount,
  o.discount_amount,
  o.delivery_fee,
  o.fulfillment_type,
  o.payment_status,
  o.razorpay_order_id,
  o.razorpay_payment_id,
  bp.name AS buyer_name,
  bp.flat_number AS buyer_flat,
  sp.business_name AS seller_name,
  sp.id AS seller_id,
  (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
  (SELECT sum(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id) AS items_subtotal,
  pr.payment_mode,
  pr.payment_collection,
  pr.payment_status AS payment_record_status,
  pr.razorpay_payment_id AS payment_reference,
  pr.platform_fee,
  pr.created_at AS payment_initiated_at,
  da.status AS delivery_status,
  da.assigned_at AS delivery_assigned_at,
  da.pickup_at AS delivery_picked_up_at,
  da.at_gate_at AS delivery_at_gate_at,
  da.delivered_at AS delivery_completed_at,
  da.failure_owner,
  da.failed_reason,
  da.rider_name,
  da.otp_attempt_count,
  ss.settlement_status,
  ss.net_amount AS seller_payout,
  ss.eligible_at AS settlement_eligible_at,
  ss.settled_at AS settlement_paid_at,
  ss.hold_reason AS settlement_hold_reason
FROM orders o
LEFT JOIN profiles bp ON bp.id = o.buyer_id
LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
LEFT JOIN payment_records pr ON pr.order_id = o.id
LEFT JOIN delivery_assignments da ON da.order_id = o.id
LEFT JOIN seller_settlements ss ON ss.order_id = o.id;
