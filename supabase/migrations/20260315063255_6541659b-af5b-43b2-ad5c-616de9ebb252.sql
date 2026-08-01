
-- Seed seller_hint for all existing workflow steps where it's currently NULL
UPDATE public.category_status_flows SET seller_hint = CASE status_key
  -- Cart Purchase / Self-Fulfillment statuses
  WHEN 'placed' THEN 'New order received. Review items and accept or reject promptly.'
  WHEN 'accepted' THEN 'You accepted this order. Begin preparation when ready.'
  WHEN 'preparing' THEN 'Order is being prepared. Mark as ready when complete.'
  WHEN 'ready' THEN 'Order is ready. Notify the buyer or hand off to delivery.'
  WHEN 'picked_up' THEN 'Delivery partner picked up the order. No action needed.'
  WHEN 'on_the_way' THEN 'Order is in transit. Monitor for any delivery issues.'
  WHEN 'delivered' THEN 'Order delivered successfully. Awaiting buyer confirmation.'
  WHEN 'completed' THEN 'Order completed and settled. Check your earnings dashboard.'
  WHEN 'cancelled' THEN 'This order was cancelled. Check cancellation reason for details.'
  -- Service Booking statuses
  WHEN 'requested' THEN 'New booking request received. Review and confirm or decline.'
  WHEN 'rescheduled' THEN 'Appointment has been rescheduled. Check the new date and time.'
  WHEN 'confirmed' THEN 'You confirmed the booking. Prepare for the appointment.'
  WHEN 'scheduled' THEN 'Appointment is scheduled. Ensure availability at the set time.'
  WHEN 'arrived' THEN 'You have arrived at the customer location. Begin the service.'
  WHEN 'in_progress' THEN 'Service is in progress. Mark complete when finished.'
  WHEN 'no_show' THEN 'Customer did not show up. No-show fee may apply.'
  -- Enquiry / Request Service statuses
  WHEN 'enquired' THEN 'New enquiry received. Send a quote or respond to the customer.'
  WHEN 'quoted' THEN 'Quote sent to buyer. Waiting for their acceptance.'
  -- Delivery-specific
  WHEN 'assigned' THEN 'Delivery partner has been assigned. Order will be picked up soon.'
  WHEN 'at_gate' THEN 'Delivery partner is at the society gate. Awaiting entry clearance.'
  -- Return
  WHEN 'returned' THEN 'Order has been returned. Process the return and update inventory.'
  ELSE 'Action may be required. Check order details.'
END
WHERE seller_hint IS NULL OR seller_hint = '';
