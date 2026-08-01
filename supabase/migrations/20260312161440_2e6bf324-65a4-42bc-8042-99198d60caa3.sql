UPDATE public.seller_profiles
SET availability_start = '00:00:00',
    availability_end = '00:00:00',
    operating_days = ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
WHERE id = 'fb4b98b6-90d5-49d4-9167-d4abd3b7dcde';