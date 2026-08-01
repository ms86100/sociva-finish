UPDATE category_status_flows 
SET is_deprecated = true 
WHERE transaction_type = 'service_booking' 
AND status_key IN ('requested', 'rescheduled', 'scheduled')
AND is_deprecated = false;