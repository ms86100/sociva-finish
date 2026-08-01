ALTER TABLE category_status_flows ADD COLUMN otp_type text DEFAULT NULL;

UPDATE category_status_flows SET otp_type = 'delivery' WHERE requires_otp = true;