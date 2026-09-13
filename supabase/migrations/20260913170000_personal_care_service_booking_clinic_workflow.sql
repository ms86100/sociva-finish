-- Personal care salon service_booking workflow (B Bounce / walk-in book).
-- Primary path: confirmed -> in_progress -> completed (slot already set at booking create).
-- Removes mobile-tech path (on_the_way / arrived) for this pair only.
-- home_services / domestic_help mobile journeys are unchanged.

DELETE FROM public.category_status_transitions
WHERE parent_group = 'personal_care' AND transaction_type = 'service_booking';

DELETE FROM public.category_status_flows
WHERE parent_group = 'personal_care' AND transaction_type = 'service_booking';

INSERT INTO public.category_status_flows (
  parent_group, transaction_type, display_name, statuses, status_key, sort_order,
  actor, is_terminal, is_transit, creates_tracking_assignment, is_deprecated,
  display_label, color, icon, buyer_hint, seller_hint,
  notify_buyer, notify_seller, silent_push, is_success, requires_otp,
  buyer_display_label, seller_display_label
) VALUES
('personal_care', 'service_booking', 'Salon Booking', '{}', 'confirmed', 10,
 'seller', false, false, false, false,
 'Booked', 'bg-green-100 text-green-700', 'CheckCircle',
 'Your appointment is booked. See you at the scheduled time.',
 'New appointment booked. Start the session when the guest arrives.',
 true, true, false, true, false,
 'Booked', 'Booked'),
('personal_care', 'service_booking', 'Salon Booking', '{}', 'in_progress', 20,
 'seller', false, false, false, false,
 'In progress', 'bg-purple-100 text-purple-700', 'PlayCircle',
 'Your session is in progress.',
 'Session in progress. Mark completed when finished.',
 true, false, false, true, false,
 'In progress', 'In progress'),
('personal_care', 'service_booking', 'Salon Booking', '{}', 'completed', 30,
 'seller', true, false, false, false,
 'Completed', 'bg-green-100 text-green-800', 'CheckCircle2',
 'Session completed. You can leave a review.',
 'Session completed.',
 true, false, false, true, false,
 'Completed', 'Completed'),
('personal_care', 'service_booking', 'Salon Booking', '{}', 'cancelled', 40,
 'buyer', true, false, false, false,
 'Cancelled', 'bg-red-100 text-red-700', 'XCircle',
 'This appointment was cancelled.',
 'This appointment was cancelled.',
 true, true, false, false, false,
 'Cancelled', 'Cancelled'),
('personal_care', 'service_booking', 'Salon Booking', '{}', 'no_show', 50,
 'seller', true, false, false, false,
 'No show', 'bg-gray-100 text-gray-700', 'UserX',
 'Marked as no-show.',
 'Guest did not show up.',
 true, false, false, false, false,
 'No show', 'No show');

INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action, display_label
) VALUES
('personal_care', 'service_booking', 'confirmed', 'in_progress', 'seller', false, 'Start session'),
('personal_care', 'service_booking', 'in_progress', 'completed', 'seller', false, 'Mark completed'),
('personal_care', 'service_booking', 'confirmed', 'cancelled', 'seller', false, 'Cancel'),
('personal_care', 'service_booking', 'confirmed', 'cancelled', 'buyer', false, 'Cancel'),
('personal_care', 'service_booking', 'in_progress', 'cancelled', 'seller', false, 'Cancel'),
('personal_care', 'service_booking', 'in_progress', 'cancelled', 'buyer', false, 'Cancel'),
('personal_care', 'service_booking', 'confirmed', 'no_show', 'seller', true, 'No show'),
('personal_care', 'service_booking', 'in_progress', 'no_show', 'seller', true, 'No show');
