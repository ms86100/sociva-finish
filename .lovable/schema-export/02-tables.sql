-- ============================================================
-- Section 2: CREATE TABLE Statements (143 tables)
-- Generated: 2026-03-12
-- ============================================================

CREATE TABLE public.admin_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  value text,
  is_active boolean DEFAULT false,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ai_review_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  decision text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  reason text,
  rule_hits jsonb DEFAULT '[]'::jsonb,
  input_snapshot jsonb DEFAULT '{}'::jsonb,
  model_used text,
  society_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.attribute_block_library (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  block_type text NOT NULL,
  category_hints _text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description text,
  display_name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  renderer_type text NOT NULL DEFAULT 'text'::text,
  schema jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  society_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log_archive (
  id uuid NOT NULL,
  actor_id uuid,
  society_id uuid,
  target_type text NOT NULL,
  target_id uuid,
  action text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL,
  archived_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.authorized_persons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  flat_number text NOT NULL,
  is_active boolean DEFAULT true,
  person_name text NOT NULL,
  phone text,
  photo_url text,
  relationship text NOT NULL DEFAULT 'family'::text,
  resident_id uuid NOT NULL,
  society_id uuid NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.badge_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tag_key text NOT NULL,
  badge_label text NOT NULL,
  color text NOT NULL DEFAULT 'bg-primary text-primary-foreground'::text,
  priority integer NOT NULL DEFAULT 100,
  layout_visibility _text[] NOT NULL DEFAULT ARRAY['ecommerce'::text, 'food'::text, 'service'::text],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.builder_announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL,
  society_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'update'::text,
  posted_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.builder_feature_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL,
  package_id uuid NOT NULL,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone,
  assigned_by uuid
);

CREATE TABLE public.builder_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  deactivated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.builder_societies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL,
  society_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.builders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  logo_url text,
  contact_email text,
  contact_phone text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  address text,
  latitude numeric,
  longitude numeric
);

CREATE TABLE public.bulletin_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.bulletin_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  author_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'alert'::text,
  title text NOT NULL,
  body text,
  attachment_urls _text[] DEFAULT '{}'::text[],
  is_pinned boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  poll_options jsonb,
  poll_deadline timestamp with time zone,
  event_date timestamp with time zone,
  event_location text,
  rsvp_enabled boolean NOT NULL DEFAULT false,
  comment_count integer NOT NULL DEFAULT 0,
  vote_count integer NOT NULL DEFAULT 0,
  ai_summary text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.bulletin_rsvps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'going'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.bulletin_votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  poll_option_id text,
  vote_type text NOT NULL DEFAULT 'upvote'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.call_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  outcome text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  body text NOT NULL,
  cleaned_count integer NOT NULL DEFAULT 0,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  data jsonb,
  failed_count integer NOT NULL DEFAULT 0,
  sent_by uuid NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'::text,
  target_platform text NOT NULL DEFAULT 'fcm'::text,
  target_society_id uuid,
  target_user_ids _text[],
  targeted_count integer NOT NULL DEFAULT 0,
  title text NOT NULL
);

CREATE TABLE public.cart_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  society_id uuid
);

CREATE TABLE public.category_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category service_category NOT NULL,
  display_name text NOT NULL,
  icon text NOT NULL,
  color text NOT NULL,
  parent_group text NOT NULL,
  is_physical_product boolean DEFAULT false,
  requires_preparation boolean DEFAULT false,
  requires_time_slot boolean DEFAULT false,
  requires_delivery boolean DEFAULT false,
  supports_cart boolean DEFAULT false,
  enquiry_only boolean DEFAULT false,
  has_quantity boolean DEFAULT true,
  has_duration boolean DEFAULT false,
  has_date_range boolean DEFAULT false,
  is_negotiable boolean DEFAULT false,
  layout_type text NOT NULL DEFAULT 'ecommerce'::text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  accepts_preorders boolean NOT NULL DEFAULT false,
  default_sort text NOT NULL DEFAULT 'popular'::text,
  description_placeholder text,
  duration_label text,
  image_aspect_ratio text NOT NULL DEFAULT '1:1'::text,
  image_object_fit text NOT NULL DEFAULT 'cover'::text,
  image_url text,
  lead_time_hours integer,
  name_placeholder text,
  placeholder_emoji text,
  preorder_cutoff_time text,
  price_label text,
  price_prefix text,
  primary_button_label text NOT NULL DEFAULT 'Order'::text,
  requires_availability boolean NOT NULL DEFAULT false,
  requires_price boolean NOT NULL DEFAULT true,
  review_dimensions _text[],
  show_duration_field boolean NOT NULL DEFAULT false,
  show_veg_toggle boolean NOT NULL DEFAULT false,
  supports_brand_display boolean NOT NULL DEFAULT false,
  supports_warranty_display boolean NOT NULL DEFAULT false,
  transaction_type text NOT NULL DEFAULT 'purchase'::text,
  supports_addons boolean NOT NULL DEFAULT false,
  supports_recurring boolean NOT NULL DEFAULT false,
  supports_staff_assignment boolean NOT NULL DEFAULT false
);

CREATE TABLE public.category_status_flows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor text NOT NULL DEFAULT 'system'::text,
  created_at timestamp with time zone DEFAULT now(),
  is_terminal boolean DEFAULT false,
  parent_group text NOT NULL,
  sort_order integer NOT NULL,
  status_key text NOT NULL,
  transaction_type text NOT NULL
);

CREATE TABLE public.chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  message_text text NOT NULL,
  read_status boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.collective_buy_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  quantity integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE TABLE public.collective_buy_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  current_quantity integer NOT NULL DEFAULT 0,
  description text,
  expires_at timestamp with time zone,
  image_url text,
  min_quantity integer NOT NULL DEFAULT 1,
  product_name text NOT NULL,
  society_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  target_price numeric,
  unit text NOT NULL DEFAULT 'unit'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.collective_escalations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  category text NOT NULL,
  tower_id uuid,
  snag_count integer NOT NULL DEFAULT 0,
  resident_count integer NOT NULL DEFAULT 0,
  sample_photos _text[] DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'active'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

CREATE TABLE public.construction_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  stage text NOT NULL DEFAULT 'foundation'::text,
  photos _text[] DEFAULT '{}'::text[],
  completion_percentage integer NOT NULL DEFAULT 0,
  posted_by uuid NOT NULL,
  tower_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.coupon_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL,
  user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  discount_applied numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.coupons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  society_id uuid,
  code text NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percentage'::text,
  discount_value numeric NOT NULL DEFAULT 0,
  min_order_amount numeric DEFAULT 0,
  max_discount_amount numeric,
  usage_limit integer,
  times_used integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  show_to_buyers boolean NOT NULL DEFAULT true,
  starts_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_addresses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid,
  label text NOT NULL DEFAULT 'Home'::text,
  flat_number text NOT NULL DEFAULT ''::text,
  block text DEFAULT ''::text,
  floor text DEFAULT ''::text,
  building_name text DEFAULT ''::text,
  landmark text DEFAULT ''::text,
  full_address text DEFAULT ''::text,
  latitude double precision,
  longitude double precision,
  pincode text DEFAULT ''::text,
  is_default boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  phase text
);

CREATE TABLE public.delivery_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  partner_id uuid,
  society_id uuid NOT NULL,
  rider_name text,
  rider_phone text,
  rider_photo_url text,
  status text NOT NULL DEFAULT 'pending'::text,
  gate_entry_id uuid,
  otp_hash text,
  otp_expires_at timestamp with time zone,
  otp_attempt_count integer NOT NULL DEFAULT 0,
  max_otp_attempts integer NOT NULL DEFAULT 3,
  delivery_fee numeric NOT NULL DEFAULT 0,
  partner_payout numeric NOT NULL DEFAULT 0,
  platform_margin numeric NOT NULL DEFAULT 0,
  pickup_at timestamp with time zone,
  at_gate_at timestamp with time zone,
  delivered_at timestamp with time zone,
  failed_reason text,
  attempt_count integer NOT NULL DEFAULT 0,
  external_tracking_id text,
  idempotency_key text NOT NULL,
  eta_minutes integer,
  distance_meters integer,
  last_location_lat double precision,
  last_location_lng double precision,
  last_location_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  assigned_at timestamp with time zone,
  delivery_code text,
  failure_owner text,
  rider_id uuid,
  stalled_notified boolean DEFAULT false
);

CREATE TABLE public.delivery_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  speed_kmh double precision,
  heading double precision,
  accuracy_meters double precision,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_partner_pool (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  added_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean DEFAULT true,
  is_available boolean DEFAULT true,
  name text NOT NULL,
  phone text NOT NULL,
  photo_url text,
  rating numeric,
  society_id uuid NOT NULL,
  total_deliveries integer DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid,
  vehicle_number text,
  vehicle_type text
);

CREATE TABLE public.delivery_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  name text NOT NULL,
  provider_type text NOT NULL DEFAULT '3pl'::text,
  api_config jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_tracking_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  status text NOT NULL,
  location_lat numeric,
  location_lng numeric,
  note text,
  source text NOT NULL DEFAULT 'system'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.device_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL,
  platform text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  apns_token text
);

CREATE TABLE public.dispute_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  is_committee_note boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.dispute_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  category text NOT NULL DEFAULT 'other'::text,
  description text NOT NULL,
  photo_urls _text[] DEFAULT '{}'::text[],
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'submitted'::text,
  sla_deadline timestamp with time zone NOT NULL DEFAULT (now() + '48:00:00'::interval),
  acknowledged_at timestamp with time zone,
  resolved_at timestamp with time zone,
  resolution_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.domestic_help_attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  help_entry_id uuid NOT NULL,
  society_id uuid NOT NULL,
  check_in_at timestamp with time zone NOT NULL DEFAULT now(),
  check_out_at timestamp with time zone,
  marked_by uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.domestic_help_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  help_name text NOT NULL,
  help_phone text,
  help_type text NOT NULL DEFAULT 'maid'::text,
  photo_url text,
  flat_number text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.emergency_broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  sent_by uuid NOT NULL,
  category text NOT NULL DEFAULT 'general'::text,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.expense_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  flagged_by uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  admin_response text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  resolved_by uuid
);

CREATE TABLE public.expense_views (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  user_id uuid NOT NULL,
  viewed_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.favorites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  society_id uuid
);

CREATE TABLE public.feature_package_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  feature_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE public.feature_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  package_name text NOT NULL,
  description text,
  price_tier text NOT NULL DEFAULT 'free'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  price_amount numeric,
  price_period text
);

CREATE TABLE public.featured_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  reference_id text NOT NULL,
  title text,
  image_url text,
  link_url text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  society_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  auto_rotate_seconds integer NOT NULL DEFAULT 5,
  bg_color text,
  button_text text,
  subtitle text,
  template text
);

CREATE TABLE public.gate_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  society_id uuid NOT NULL,
  entry_time timestamp with time zone NOT NULL DEFAULT now(),
  entry_type text NOT NULL DEFAULT 'qr_verified'::text,
  verified_by uuid,
  confirmation_status text DEFAULT 'not_required'::text,
  flat_number text,
  resident_name text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  awaiting_confirmation boolean NOT NULL DEFAULT false,
  confirmation_denied_at timestamp with time zone,
  confirmation_expires_at timestamp with time zone,
  confirmed_by_resident_at timestamp with time zone
);

CREATE TABLE public.help_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  author_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  tag text NOT NULL DEFAULT 'question'::text,
  status text NOT NULL DEFAULT 'open'::text,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '24:00:00'::interval),
  response_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.help_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  responder_id uuid NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.inspection_checklists (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  tower_id uuid,
  flat_number text NOT NULL,
  resident_id uuid NOT NULL,
  inspection_date date,
  status text NOT NULL DEFAULT 'draft'::text,
  overall_score numeric DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  passed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  notes text,
  submitted_at timestamp with time zone,
  builder_acknowledged_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  builder_acknowledged_by uuid,
  builder_notes text
);

CREATE TABLE public.inspection_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL,
  category text NOT NULL,
  item_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'not_checked'::text,
  severity text DEFAULT 'minor'::text,
  photo_urls _text[] DEFAULT '{}'::text[],
  notes text,
  display_order integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.job_tts_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  job_id uuid NOT NULL,
  language_code text NOT NULL,
  summary_text text NOT NULL
);

CREATE TABLE public.maintenance_dues (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  flat_identifier text NOT NULL,
  resident_id uuid,
  month text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text,
  paid_date date,
  receipt_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.manual_entry_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  flat_number text NOT NULL,
  claimed_name text NOT NULL,
  requested_by uuid,
  resident_id uuid,
  status text NOT NULL DEFAULT 'pending'::text,
  responded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:05:00'::interval)
);

CREATE TABLE public.marketplace_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid,
  seller_id uuid,
  category text,
  layout_type text,
  event_type text NOT NULL,
  user_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.milestone_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'thumbsup'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chat boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  orders boolean NOT NULL DEFAULT true,
  promotions boolean NOT NULL DEFAULT true,
  sounds boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

CREATE TABLE public.notification_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'general'::text,
  reference_path text,
  payload jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  next_retry_at timestamp with time zone,
  retry_count integer DEFAULT 0,
  last_error text
);

CREATE TABLE public.order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.order_status_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  color text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status_key text NOT NULL
);

CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid,
  seller_id uuid,
  society_id uuid,
  status order_status DEFAULT 'placed'::order_status,
  total_amount numeric NOT NULL,
  payment_type text DEFAULT 'cod'::text,
  payment_status text DEFAULT 'pending'::text,
  delivery_address text,
  notes text,
  rejection_reason text,
  auto_cancel_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  order_type text DEFAULT 'purchase'::text,
  scheduled_date date,
  scheduled_time_start time without time zone,
  scheduled_time_end time without time zone,
  rental_start_date date,
  rental_end_date date,
  deposit_paid boolean DEFAULT false,
  deposit_refunded boolean DEFAULT false,
  coupon_id uuid,
  discount_amount numeric DEFAULT 0,
  fulfillment_type text NOT NULL DEFAULT 'self_pickup'::text,
  delivery_fee numeric NOT NULL DEFAULT 0,
  idempotency_key text,
  buyer_society_id uuid,
  delivery_handled_by text,
  is_cross_society boolean NOT NULL DEFAULT false,
  razorpay_order_id text,
  razorpay_payment_id text,
  ready_at timestamp with time zone,
  seller_society_id uuid,
  distance_km numeric,
  delivery_address_id uuid,
  delivery_lat double precision,
  delivery_lng double precision,
  upi_transaction_ref text,
  payment_confirmed_by_seller boolean,
  payment_confirmed_at timestamp with time zone
);

CREATE TABLE public.orders_archive (
  id uuid NOT NULL,
  buyer_id uuid,
  seller_id uuid,
  society_id uuid,
  status text,
  total_amount numeric NOT NULL,
  payment_status text,
  payment_type text,
  order_type text,
  notes text,
  delivery_address text,
  rejection_reason text,
  discount_amount numeric DEFAULT 0,
  coupon_id uuid,
  deposit_paid boolean DEFAULT false,
  deposit_refunded boolean DEFAULT false,
  rental_start_date date,
  rental_end_date date,
  scheduled_date date,
  scheduled_time_start time without time zone,
  scheduled_time_end time without time zone,
  auto_cancel_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  archived_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.parcel_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  flat_number text,
  courier_name text,
  tracking_number text,
  description text,
  status text NOT NULL DEFAULT 'received'::text,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  collected_at timestamp with time zone,
  collected_by text,
  photo_url text,
  notified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  logged_by uuid
);

CREATE TABLE public.parent_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  icon text NOT NULL DEFAULT ''::text,
  color text NOT NULL DEFAULT ''::text,
  description text NOT NULL DEFAULT ''::text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  requires_license boolean NOT NULL DEFAULT false,
  license_type_name text,
  license_description text,
  license_mandatory boolean NOT NULL DEFAULT false,
  layout_type text DEFAULT 'ecommerce'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  placeholder_hint text
);

CREATE TABLE public.parking_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  slot_number text NOT NULL,
  slot_type text NOT NULL DEFAULT 'car'::text,
  tower_id uuid,
  assigned_to uuid,
  vehicle_number text,
  vehicle_type text,
  is_occupied boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.parking_violations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  slot_id uuid,
  reported_by uuid NOT NULL,
  vehicle_number text,
  violation_type text NOT NULL DEFAULT 'unauthorized'::text,
  description text,
  photo_url text,
  status text NOT NULL DEFAULT 'open'::text,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  tower_id uuid,
  title text NOT NULL,
  description text,
  milestone_stage text NOT NULL DEFAULT 'booking'::text,
  amount_percentage numeric NOT NULL DEFAULT 0,
  due_date date,
  status text NOT NULL DEFAULT 'upcoming'::text,
  linked_milestone_id uuid,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid,
  amount numeric NOT NULL,
  payment_method text NOT NULL DEFAULT 'cod'::text,
  payment_status text NOT NULL DEFAULT 'pending'::text,
  transaction_reference text,
  platform_fee numeric DEFAULT 0,
  net_amount numeric,
  idempotency_key text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  payment_collection text NOT NULL DEFAULT 'direct'::text,
  payment_mode text NOT NULL DEFAULT 'offline'::text,
  razorpay_payment_id text,
  society_id uuid
);

CREATE TABLE public.payment_settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  order_id uuid NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  platform_fee numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  settlement_status text NOT NULL DEFAULT 'pending'::text,
  settlement_date timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.phone_otp_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  phone_number text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  verified_at timestamp with time zone
);

CREATE TABLE public.platform_features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  feature_key text NOT NULL,
  feature_name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'operations'::text,
  is_core boolean NOT NULL DEFAULT false,
  is_experimental boolean NOT NULL DEFAULT false,
  society_configurable boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  audience _text[],
  capabilities _text[],
  display_name text,
  icon_name text,
  route text,
  tagline text
);

CREATE TABLE public.price_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  changed_by uuid,
  new_price numeric NOT NULL,
  old_price numeric NOT NULL,
  product_id uuid NOT NULL
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  society_id uuid,
  name text NOT NULL,
  description text,
  price numeric NOT NULL,
  image_url text,
  category text NOT NULL,
  is_veg boolean DEFAULT true,
  is_available boolean DEFAULT true,
  is_bestseller boolean DEFAULT false,
  is_recommended boolean DEFAULT false,
  is_urgent boolean DEFAULT false,
  approval_status text NOT NULL DEFAULT 'draft'::text,
  stock_quantity integer,
  specifications jsonb,
  listing_type text DEFAULT 'product'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  service_duration_minutes integer,
  deposit_amount numeric,
  rental_period_type text,
  min_rental_duration integer,
  max_rental_duration integer,
  condition text,
  is_negotiable boolean DEFAULT false,
  location_required boolean DEFAULT false,
  available_slots jsonb,
  accepts_preorders boolean NOT NULL DEFAULT false,
  action_type text NOT NULL DEFAULT 'add_to_cart'::text,
  brand text,
  bullet_features _text[],
  contact_phone text,
  cuisine_type text,
  delivery_time_text text,
  discount_percentage numeric,
  ingredients text,
  lead_time_hours integer,
  low_stock_threshold integer,
  minimum_charge numeric,
  mrp numeric,
  preorder_cutoff_time text,
  prep_time_minutes integer,
  price_per_unit text,
  price_stable_since timestamp with time zone,
  secondary_images _text[],
  service_scope text,
  serving_size text,
  spice_level text,
  subcategory_id uuid,
  tags _text[],
  unit_type text,
  visit_charge numeric,
  warranty_period text,
  rejection_note text,
  updated_while_pending boolean NOT NULL DEFAULT false
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  phone text NOT NULL,
  name text NOT NULL,
  flat_number text NOT NULL,
  block text NOT NULL,
  phase text,
  email text,
  avatar_url text,
  society_id uuid,
  verification_status verification_status DEFAULT 'pending'::verification_status,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  browse_beyond_community boolean NOT NULL DEFAULT false,
  has_seen_onboarding boolean NOT NULL DEFAULT false,
  search_radius_km numeric NOT NULL DEFAULT 5,
  phone_verified boolean NOT NULL DEFAULT false
);

CREATE TABLE public.project_answers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  answered_by uuid NOT NULL,
  answer_text text NOT NULL,
  is_official boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.project_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  tower_id uuid,
  category text NOT NULL DEFAULT 'other'::text,
  title text NOT NULL,
  description text,
  file_url text NOT NULL,
  uploaded_by uuid NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.project_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  asked_by uuid NOT NULL,
  category text NOT NULL DEFAULT 'general'::text,
  question_text text NOT NULL,
  is_answered boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.project_towers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  name text NOT NULL,
  total_floors integer NOT NULL DEFAULT 0,
  expected_completion date,
  revised_completion date,
  delay_reason text,
  delay_category text,
  current_stage text NOT NULL DEFAULT 'foundation'::text,
  current_percentage integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.push_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info'::text,
  message text NOT NULL,
  metadata jsonb,
  user_id uuid
);

CREATE TABLE public.rate_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  window_start timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reported_user_id uuid,
  reported_seller_id uuid,
  report_type text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending'::text,
  admin_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.resident_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  society_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending'::text,
  paid_at timestamp with time zone,
  receipt_url text,
  transaction_reference text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  buyer_id uuid,
  seller_id uuid NOT NULL,
  rating integer NOT NULL,
  comment text,
  is_hidden boolean DEFAULT false,
  hidden_reason text,
  created_at timestamp with time zone DEFAULT now(),
  society_id uuid
);

CREATE TABLE public.search_demand_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text,
  search_term text NOT NULL,
  searched_at timestamp with time zone NOT NULL DEFAULT now(),
  society_id uuid
);

CREATE TABLE public.security_staff (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'security_officer'::text,
  is_active boolean DEFAULT true,
  deactivated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_contact_interactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  product_id uuid,
  interaction_type text NOT NULL DEFAULT 'call'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_conversation_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  message_text text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  product_id uuid,
  last_message_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_form_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  seller_id uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  group_id uuid NOT NULL,
  license_type text NOT NULL,
  license_number text,
  document_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  admin_notes text,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_at timestamp with time zone
);

CREATE TABLE public.seller_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid,
  business_name text NOT NULL,
  description text,
  categories _text[] NOT NULL DEFAULT '{}'::text[],
  primary_group text,
  cover_image_url text,
  profile_image_url text,
  is_available boolean DEFAULT true,
  availability_start time without time zone,
  availability_end time without time zone,
  operating_days _text[] DEFAULT ARRAY['Mon'::text, 'Tue'::text, 'Wed'::text, 'Thu'::text, 'Fri'::text, 'Sat'::text, 'Sun'::text],
  accepts_cod boolean DEFAULT true,
  accepts_upi boolean DEFAULT false,
  upi_id text,
  fssai_number text,
  is_featured boolean DEFAULT false,
  verification_status verification_status DEFAULT 'pending'::verification_status,
  rating numeric DEFAULT 0,
  total_reviews integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  avg_response_minutes integer,
  bank_account_holder text,
  bank_account_number text,
  bank_ifsc_code text,
  cancellation_rate numeric,
  completed_order_count integer,
  delivery_handled_by text,
  delivery_note text,
  delivery_radius_km numeric NOT NULL DEFAULT 5,
  food_license_reviewed_at timestamp with time zone,
  food_license_status text,
  food_license_submitted_at timestamp with time zone,
  food_license_url text,
  fulfillment_mode text NOT NULL DEFAULT 'pickup'::text,
  last_active_at timestamp with time zone,
  minimum_order_amount numeric,
  on_time_delivery_pct numeric,
  razorpay_account_id text,
  razorpay_onboarding_status text,
  sell_beyond_community boolean NOT NULL DEFAULT false,
  daily_order_limit integer,
  low_stock_alert_threshold integer DEFAULT 3,
  rejection_note text,
  latitude double precision,
  longitude double precision,
  seller_type seller_type_enum NOT NULL DEFAULT 'society_resident'::seller_type_enum,
  store_location_source text
);

CREATE TABLE public.seller_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  recommender_id uuid NOT NULL,
  society_id uuid,
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_reputation_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_detail jsonb,
  event_type text NOT NULL,
  is_positive boolean NOT NULL DEFAULT true,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  seller_id uuid NOT NULL
);

CREATE TABLE public.seller_settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  delivery_fee_share numeric NOT NULL DEFAULT 0,
  eligible_at timestamp with time zone,
  gross_amount numeric NOT NULL DEFAULT 0,
  hold_reason text,
  net_amount numeric NOT NULL DEFAULT 0,
  order_id uuid NOT NULL,
  platform_fee numeric NOT NULL DEFAULT 0,
  razorpay_transfer_id text,
  seller_id uuid NOT NULL,
  settled_at timestamp with time zone,
  settlement_status text NOT NULL DEFAULT 'pending'::text,
  society_id uuid NOT NULL,
  updated_at timestamp with time zone
);

CREATE TABLE public.service_addons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_availability_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  product_id uuid,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_booking_addons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  addon_id uuid NOT NULL,
  addon_name text NOT NULL,
  addon_price numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  product_id uuid NOT NULL,
  booking_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  location_type text NOT NULL DEFAULT 'at_seller'::text,
  buyer_address text,
  status text NOT NULL DEFAULT 'confirmed'::text,
  rescheduled_from uuid,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  staff_id uuid,
  reminder_24h_sent_at timestamp with time zone,
  reminder_1h_sent_at timestamp with time zone
);

CREATE TABLE public.service_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  service_type text NOT NULL DEFAULT 'scheduled'::text,
  location_type text NOT NULL DEFAULT 'at_seller'::text,
  duration_minutes integer NOT NULL DEFAULT 60,
  buffer_minutes integer NOT NULL DEFAULT 0,
  max_bookings_per_slot integer NOT NULL DEFAULT 1,
  price_model text NOT NULL DEFAULT 'fixed'::text,
  cancellation_notice_hours integer NOT NULL DEFAULT 24,
  rescheduling_notice_hours integer NOT NULL DEFAULT 12,
  cancellation_fee_percentage numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  preparation_instructions text
);

CREATE TABLE public.service_recurring_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  product_id uuid NOT NULL,
  frequency text NOT NULL DEFAULT 'weekly'::text,
  day_of_week integer NOT NULL,
  preferred_time time without time zone NOT NULL,
  start_date date NOT NULL,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  last_generated_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  slot_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  max_capacity integer NOT NULL DEFAULT 1,
  booked_count integer NOT NULL DEFAULT 0,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_staff (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  name text NOT NULL,
  phone text,
  photo_url text,
  specializations _text[] DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.session_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.skill_endorsements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL,
  endorser_id uuid NOT NULL,
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.skill_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  skill_name text NOT NULL,
  description text,
  availability text,
  trust_score numeric NOT NULL DEFAULT 0,
  endorsement_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.slot_holds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:05:00'::interval),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.slot_waitlist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL,
  product_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  notified_at timestamp with time zone
);

CREATE TABLE public.snag_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  tower_id uuid,
  flat_number text NOT NULL,
  reported_by uuid NOT NULL,
  title text,
  category text NOT NULL DEFAULT 'other'::text,
  description text NOT NULL,
  photo_urls _text[] DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'reported'::text,
  sla_deadline timestamp with time zone NOT NULL DEFAULT (now() + '72:00:00'::interval),
  assigned_to_name text,
  acknowledged_at timestamp with time zone,
  fixed_at timestamp with time zone,
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.societies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  address text,
  city text,
  state text,
  pincode text,
  latitude numeric,
  longitude numeric,
  geofence_radius_meters integer DEFAULT 500,
  is_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  admin_user_id uuid,
  member_count integer DEFAULT 0,
  logo_url text,
  rules_text text,
  invite_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  auto_approve_residents boolean DEFAULT false,
  approval_method text DEFAULT 'manual'::text,
  builder_id uuid,
  max_society_admins integer DEFAULT 5,
  is_under_construction boolean NOT NULL DEFAULT false,
  trust_score numeric NOT NULL DEFAULT 0,
  security_mode text DEFAULT 'basic'::text,
  security_confirmation_timeout_seconds integer DEFAULT 120
);

CREATE TABLE public.society_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  actor_id uuid,
  activity_type text NOT NULL,
  title text NOT NULL,
  description text,
  reference_id uuid,
  reference_type text,
  is_system boolean NOT NULL DEFAULT false,
  tower_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_admins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'admin'::text,
  appointed_by uuid,
  deactivated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  budget_amount numeric NOT NULL DEFAULT 0,
  category text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  fiscal_year text NOT NULL DEFAULT '2025-26'::text,
  society_id uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'miscellaneous'::text,
  title text NOT NULL,
  amount numeric NOT NULL,
  vendor_name text,
  invoice_url text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  added_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_feature_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  feature_id uuid NOT NULL,
  is_enabled boolean NOT NULL,
  overridden_by uuid,
  overridden_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  feature_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  society_id uuid NOT NULL
);

CREATE TABLE public.society_income (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'maintenance'::text,
  amount numeric NOT NULL,
  description text,
  income_date date NOT NULL DEFAULT CURRENT_DATE,
  added_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_notices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attachment_urls _text[],
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_pinned boolean NOT NULL DEFAULT false,
  posted_by uuid NOT NULL,
  society_id uuid NOT NULL,
  title text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_report_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  month text NOT NULL,
  report_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  society_id uuid NOT NULL
);

CREATE TABLE public.society_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  report_month text NOT NULL,
  report_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  trust_score numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_worker_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  name text NOT NULL,
  icon text DEFAULT '👤'::text,
  requires_background_check boolean DEFAULT false,
  requires_security_training boolean DEFAULT false,
  entry_type text NOT NULL DEFAULT 'daily'::text,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.society_workers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  worker_type text NOT NULL DEFAULT 'general'::text,
  skills jsonb DEFAULT '[]'::jsonb,
  languages _text[] DEFAULT '{}'::text[],
  is_verified boolean DEFAULT false,
  is_available boolean DEFAULT true,
  rating numeric DEFAULT 0,
  total_jobs integer DEFAULT 0,
  total_ratings integer DEFAULT 0,
  photo_url text,
  status text NOT NULL DEFAULT 'active'::text,
  suspension_reason text,
  allowed_shift_start time without time zone,
  allowed_shift_end time without time zone,
  active_days _text[] DEFAULT '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}'::text[],
  entry_frequency text DEFAULT 'daily'::text,
  emergency_contact_phone text,
  category_id uuid,
  registered_by uuid,
  deactivated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  preferred_language text
);

CREATE TABLE public.stock_watchlist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  notified_at timestamp with time zone,
  product_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE TABLE public.subcategories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category_config_id uuid NOT NULL,
  color text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  description_placeholder text,
  display_name text NOT NULL,
  display_order integer DEFAULT 0,
  duration_label text,
  icon text,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  name_placeholder text,
  price_label text,
  show_duration_field boolean DEFAULT false,
  show_veg_toggle boolean DEFAULT false,
  slug text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  supports_addons boolean,
  supports_recurring boolean,
  supports_staff_assignment boolean
);

CREATE TABLE public.subscription_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL,
  order_id uuid,
  scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  product_id uuid NOT NULL,
  frequency text NOT NULL DEFAULT 'daily'::text,
  quantity integer NOT NULL DEFAULT 1,
  delivery_days _text[] DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'active'::text,
  next_delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  pause_until date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.supported_languages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ai_name text NOT NULL DEFAULT ''::text,
  bcp47_tag text NOT NULL DEFAULT ''::text,
  code text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  name text NOT NULL,
  native_name text NOT NULL
);

CREATE TABLE public.system_settings (
  key text NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.test_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  module_name text NOT NULL,
  test_name text NOT NULL,
  page_or_api_url text,
  input_data jsonb,
  outcome text NOT NULL DEFAULT 'passed'::text,
  duration_ms numeric,
  response_payload jsonb,
  error_message text,
  error_code text,
  http_status_code integer,
  file_path text,
  executed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.transaction_audit_trail (
  order_id uuid,
  order_date timestamp with time zone,
  order_status order_status,
  total_amount numeric,
  payment_type text,
  payment_status text,
  society_id uuid,
  buyer_id uuid,
  seller_id uuid,
  buyer_name text,
  seller_name text,
  transaction_reference text,
  platform_fee numeric,
  net_amount numeric
);

CREATE TABLE public.trigger_errors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trigger_name text NOT NULL,
  table_name text NOT NULL,
  error_message text NOT NULL,
  error_detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.trust_tier_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tier_key text NOT NULL,
  tier_label text NOT NULL,
  min_orders integer NOT NULL DEFAULT 0,
  min_rating numeric NOT NULL DEFAULT 0,
  badge_color text NOT NULL DEFAULT 'muted'::text,
  icon_name text NOT NULL DEFAULT 'Shield'::text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  growth_label text,
  growth_icon text
);

CREATE TABLE public.user_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rating integer NOT NULL,
  message text,
  page_context text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.user_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'general'::text,
  reference_id text,
  reference_path text,
  is_read boolean NOT NULL DEFAULT false,
  society_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  queue_item_id uuid
);

CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role user_role NOT NULL DEFAULT 'buyer'::user_role,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.visitor_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  visitor_name text NOT NULL,
  visitor_phone text,
  visitor_type text NOT NULL DEFAULT 'guest'::text,
  purpose text,
  expected_date date,
  expected_time time without time zone,
  otp_code text,
  otp_expires_at timestamp with time zone,
  is_preapproved boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_days _text[],
  status text NOT NULL DEFAULT 'expected'::text,
  checked_in_at timestamp with time zone,
  checked_out_at timestamp with time zone,
  vehicle_number text,
  photo_url text,
  flat_number text,
  guard_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  parking_slot_id uuid
);

CREATE TABLE public.visitor_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  display_order integer DEFAULT 0,
  icon text,
  is_active boolean DEFAULT true,
  label text NOT NULL,
  society_id uuid,
  type_key text NOT NULL
);

CREATE TABLE public.warnings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  issued_by uuid NOT NULL,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'warning'::text,
  acknowledged_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.worker_attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  check_in_at timestamp with time zone NOT NULL DEFAULT now(),
  check_out_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  entry_method text,
  society_id uuid NOT NULL,
  verified_by uuid,
  worker_id uuid NOT NULL
);

CREATE TABLE public.worker_entry_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  society_id uuid NOT NULL,
  gate_entry_id uuid,
  entry_time timestamp with time zone NOT NULL DEFAULT now(),
  exit_time timestamp with time zone,
  validation_result text NOT NULL DEFAULT 'allowed'::text,
  denial_reason text,
  verified_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.worker_flat_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  society_id uuid NOT NULL,
  flat_number text NOT NULL,
  resident_id uuid,
  assigned_by uuid,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.worker_job_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  job_type text NOT NULL,
  description text,
  price numeric,
  duration_hours integer DEFAULT 1,
  start_time timestamp with time zone,
  location_details text,
  urgency text DEFAULT 'normal'::text,
  status text NOT NULL DEFAULT 'open'::text,
  accepted_by uuid,
  accepted_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval),
  payment_status text DEFAULT 'pending'::text,
  payment_amount numeric,
  resident_rating integer,
  worker_rating integer,
  resident_review text,
  worker_review text,
  voice_summary_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  target_society_ids _text[],
  visibility_scope text NOT NULL DEFAULT 'society'::text
);

CREATE TABLE public.worker_leave_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  leave_date date NOT NULL,
  leave_type text NOT NULL DEFAULT 'full_day'::text,
  marked_by uuid,
  reason text,
  society_id uuid NOT NULL,
  worker_id uuid NOT NULL
);

CREATE TABLE public.worker_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  society_id uuid NOT NULL,
  rated_by uuid NOT NULL,
  rating integer NOT NULL,
  review text,
  month text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.worker_salary_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  month text NOT NULL,
  notes text,
  paid_date date,
  resident_id uuid NOT NULL,
  society_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  worker_id uuid NOT NULL
);