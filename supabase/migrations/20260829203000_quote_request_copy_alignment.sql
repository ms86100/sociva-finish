-- Align enquiry/quote vocabulary for buyers and sellers.
update public.category_status_flows
set
  display_label = case
    when coalesce(display_label, '') in ('Enquiry Sent', 'Enquired', 'Enquiry sent') then 'Quote sent'
    else display_label
  end,
  buyer_display_label = coalesce(nullif(buyer_display_label, ''), 'Quote sent'),
  seller_display_label = coalesce(nullif(seller_display_label, ''), 'New quote request'),
  seller_notification_title = case
    when seller_notification_title ilike '%booking request%' then 'New quote request'
    else seller_notification_title
  end,
  buyer_hint = coalesce(nullif(buyer_hint, ''), 'Your quote request has been sent. The seller usually replies today.'),
  seller_hint = coalesce(nullif(seller_hint, ''), 'New quote request. Reply with a price or a message.')
where status_key = 'enquired';
