ALTER TABLE public.service_bookings
ADD CONSTRAINT service_bookings_staff_id_fkey
FOREIGN KEY (staff_id) REFERENCES public.service_staff(id) ON DELETE SET NULL;