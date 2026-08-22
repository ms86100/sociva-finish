-- Buyer-selectable extras for cart / enquiry / booking, plus enquiry cancel heals.

ALTER TABLE public.attribute_block_library
  ADD COLUMN IF NOT EXISTS buyer_selectable boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS selected_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS selected_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS selected_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS selected_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP FUNCTION IF EXISTS public.create_enquiry_atomic(uuid, uuid, text, text, text, numeric, text, text);
DROP FUNCTION IF EXISTS public.create_service_booking_atomic(uuid, uuid, uuid, text, text, text, numeric, text, numeric, text, text, text, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.format_selected_extras(p_extras jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(string_agg(line, E'\n'), '')
  FROM (
    SELECT
      COALESCE(item->>'fieldLabel', item->>'fieldKey', 'Option') || ': ' ||
      CASE
        WHEN jsonb_typeof(item->'value') = 'array' THEN (
          SELECT COALESCE(string_agg(val, ', '), '')
          FROM jsonb_array_elements_text(item->'value') val
        )
        WHEN jsonb_typeof(item->'value') = 'boolean' THEN CASE WHEN (item->>'value')::boolean THEN 'Yes' ELSE 'No' END
        ELSE COALESCE(item->>'value', '')
      END AS line
    FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) item
  ) formatted
  WHERE line IS NOT NULL AND length(btrim(line)) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.format_selected_extras(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.heal_enquiry_transaction_type(
  p_order_type text,
  p_listing_type text,
  p_resolved_txn text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_order_type IS DISTINCT FROM 'enquiry' THEN p_resolved_txn
    WHEN p_resolved_txn IN ('request_service', 'contact_enquiry') THEN p_resolved_txn
    ELSE public.resolve_enquiry_transaction_type(p_listing_type)
  END;
$$;

CREATE OR REPLACE FUNCTION public.create_enquiry_atomic(
  p_seller_id uuid,
  p_product_id uuid,
  p_product_name text,
  p_message text,
  p_action_title text,
  p_price numeric DEFAULT 0,
  p_listing_type text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_selected_extras jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer uuid := auth.uid();
  v_seller_user uuid;
  v_order uuid;
  v_txn text;
  v_gate jsonb;
  v_extras jsonb := COALESCE(p_selected_extras, '[]'::jsonb);
  v_extra_text text := public.format_selected_extras(COALESCE(p_selected_extras, '[]'::jsonb));
  v_notes text;
BEGIN
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT user_id INTO v_seller_user FROM public.seller_profiles WHERE id = p_seller_id;
  IF v_seller_user IS NULL THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  v_gate := public.seller_credit_can_accept(p_seller_id, 'ENQUIRY_CREATED');
  IF COALESCE((v_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', v_gate->>'reason';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order
    FROM public.orders
    WHERE buyer_id = v_buyer AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_order IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'order_id', v_order, 'idempotent', true);
    END IF;
  END IF;

  v_txn := public.resolve_enquiry_transaction_type(p_listing_type);
  v_notes := COALESCE(p_action_title, 'Request') || ' for: ' || COALESCE(p_product_name, 'listing')
    || CASE WHEN v_extra_text <> '' THEN E'\n\nExtra details\n' || v_extra_text ELSE '' END
    || E'\n\n' || COALESCE(p_message, '');

  INSERT INTO public.orders(
    buyer_id, seller_id, total_amount, order_type, status, transaction_type, notes, idempotency_key, selected_extras
  ) VALUES (
    v_buyer, p_seller_id, COALESCE(p_price, 0), 'enquiry', 'enquired', v_txn,
    v_notes, p_idempotency_key, v_extras
  )
  RETURNING id INTO v_order;

  INSERT INTO public.order_items(order_id, product_id, product_name, quantity, unit_price, selected_extras)
  VALUES (v_order, p_product_id, COALESCE(p_product_name, 'listing'), 1, COALESCE(p_price, 0), v_extras);

  INSERT INTO public.chat_messages(order_id, sender_id, receiver_id, message_text)
  VALUES (
    v_order, v_buyer, v_seller_user,
    'Hi! I would like to ' || lower(COALESCE(p_action_title, 'request')) || ' for "' || COALESCE(p_product_name, 'listing') || '".'
    || CASE WHEN v_extra_text <> '' THEN E'\n\n' || v_extra_text ELSE '' END
    || E'\n\n' || COALESCE(p_message, '')
  );

  RETURN jsonb_build_object('ok', true, 'order_id', v_order);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_enquiry_atomic(uuid, uuid, text, text, text, numeric, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_service_booking_atomic(
  _seller_id uuid,
  _product_id uuid,
  _slot_id uuid,
  _booking_date text,
  _start_time text,
  _end_time text,
  _total_amount numeric,
  _product_name text,
  _unit_price numeric,
  _idempotency_key text,
  _notes text DEFAULT NULL,
  _buyer_address text DEFAULT NULL,
  _location_type text DEFAULT 'at_seller',
  _fulfillment_type text DEFAULT NULL,
  _addons jsonb DEFAULT '[]'::jsonb,
  _recurring jsonb DEFAULT NULL,
  _selected_extras jsonb DEFAULT '[]'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _order_id uuid;
  _booking_id uuid;
  _slot_result json;
  _addon jsonb;
  _existing_order uuid;
  _seller_user uuid;
  _gate jsonb;
  _extras jsonb := COALESCE(_selected_extras, '[]'::jsonb);
  _extra_text text := public.format_selected_extras(COALESCE(_selected_extras, '[]'::jsonb));
  _combined_notes text;
BEGIN
  IF _caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM seller_profiles WHERE id = _seller_id AND user_id = _caller) THEN
    RETURN json_build_object('success', false, 'error', 'Cannot book your own service');
  END IF;

  _gate := public.seller_credit_can_accept(_seller_id, 'SERVICE_BOOKING');
  IF COALESCE((_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', COALESCE(_gate->>'reason', public.seller_credit_customer_reason('SERVICE_BOOKING')));
  END IF;

  SELECT id INTO _existing_order
  FROM orders
  WHERE buyer_id = _caller AND idempotency_key = _idempotency_key
  LIMIT 1;

  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object(
      'success', true,
      'order_id', _existing_order,
      'booking_id', _booking_id,
      'idempotent', true
    );
  END IF;

  _combined_notes := NULLIF(LEFT(trim(both FROM
    COALESCE(_notes, '') || CASE WHEN _extra_text <> '' THEN E'\n\nExtra details\n' || _extra_text ELSE '' END
  ), 800), '');

  INSERT INTO orders (
    buyer_id, seller_id, total_amount, order_type, status,
    payment_type, payment_status, transaction_type, idempotency_key,
    notes, delivery_address, fulfillment_type, selected_extras
  ) VALUES (
    _caller, _seller_id, _total_amount, 'booking', 'confirmed',
    'cod', 'pending', 'service_booking', _idempotency_key,
    _combined_notes,
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    COALESCE(_fulfillment_type, _location_type, 'at_seller'),
    _extras
  )
  RETURNING id INTO _order_id;

  INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, selected_extras)
  VALUES (_order_id, _product_id, _product_name, 1, _unit_price, _extras);

  _slot_result := public.book_service_slot(
    _order_id, _slot_id, _caller, _seller_id, _product_id,
    _booking_date, _start_time, _end_time,
    COALESCE(_location_type, 'at_seller'),
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    _combined_notes
  );

  IF COALESCE((_slot_result->>'success')::boolean, false) IS NOT TRUE THEN
    UPDATE orders SET status = 'cancelled', notes = COALESCE(notes, '') || ' [booking_setup_failed]'
    WHERE id = _order_id;
    RETURN json_build_object(
      'success', false,
      'error', COALESCE(_slot_result->>'error', 'Failed to book slot'),
      'order_id', _order_id
    );
  END IF;

  _booking_id := (_slot_result->>'booking_id')::uuid;

  UPDATE public.service_bookings
  SET selected_extras = _extras
  WHERE id = _booking_id;

  IF _addons IS NOT NULL AND jsonb_typeof(_addons) = 'array' THEN
    FOR _addon IN SELECT * FROM jsonb_array_elements(_addons)
    LOOP
      INSERT INTO service_booking_addons (booking_id, addon_id, addon_name, addon_price)
      VALUES (
        _booking_id,
        NULLIF(_addon->>'id', '')::uuid,
        COALESCE(_addon->>'name', 'Add-on'),
        COALESCE((_addon->>'price')::numeric, 0)
      );
    END LOOP;
  END IF;

  IF _recurring IS NOT NULL AND COALESCE((_recurring->>'enabled')::boolean, false) THEN
    INSERT INTO service_recurring_configs (
      booking_id, buyer_id, seller_id, product_id,
      frequency, preferred_time, start_date, end_date, day_of_week
    ) VALUES (
      _booking_id, _caller, _seller_id, _product_id,
      COALESCE(_recurring->>'frequency', 'weekly'),
      _start_time::time,
      _booking_date::date,
      NULLIF(_recurring->>'endDate', '')::date,
      COALESCE((_recurring->>'dayOfWeek')::int, EXTRACT(DOW FROM _booking_date::date)::int)
    );
  END IF;

  SELECT user_id INTO _seller_user FROM seller_profiles WHERE id = _seller_id;
  IF _seller_user IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      _seller_user,
      'order',
      'New Booking Confirmed',
      'A customer booked ' || _product_name || ' on ' || _booking_date || ' at ' || LEFT(_start_time, 5),
      '/orders/' || _order_id::text,
      jsonb_build_object('orderId', _order_id, 'status', 'confirmed', 'type', 'order')
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'order_id', _order_id,
    'booking_id', _booking_id,
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _existing_order
  FROM orders WHERE buyer_id = _caller AND idempotency_key = _idempotency_key LIMIT 1;
  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object('success', true, 'order_id', _existing_order, 'booking_id', _booking_id, 'idempotent', true);
  END IF;
  RETURN json_build_object('success', false, 'error', SQLERRM);
WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_service_booking_atomic(uuid, uuid, uuid, text, text, text, numeric, text, numeric, text, text, text, text, text, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- Buyer cancel coverage for enquiry + booking on every live parent group.
INSERT INTO public.category_status_transitions (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action)
SELECT g.parent_group, t.transaction_type, t.from_status, 'cancelled', 'buyer', true
FROM (
  SELECT DISTINCT parent_group FROM public.category_config WHERE parent_group IS NOT NULL
  UNION
  SELECT unnest(ARRAY[
    'default','domestic_help','education_learning','events','food_beverages','health',
    'home_services','personal_care','pets','professional','property','rentals','resale'
  ])
) AS g(parent_group)
CROSS JOIN (
  VALUES
    ('request_service', 'enquired'),
    ('request_service', 'quoted'),
    ('request_service', 'accepted'),
    ('contact_enquiry', 'enquired'),
    ('contact_enquiry', 'quoted'),
    ('service_booking', 'confirmed'),
    ('service_booking', 'requested'),
    ('service_booking', 'scheduled'),
    ('service_booking', 'rescheduled')
) AS t(transaction_type, from_status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.category_status_transitions existing
  WHERE existing.parent_group = g.parent_group
    AND existing.transaction_type = t.transaction_type
    AND existing.from_status = t.from_status
    AND existing.to_status = 'cancelled'
    AND existing.allowed_actor = 'buyer'
);

UPDATE public.orders o
SET transaction_type = public.resolve_enquiry_transaction_type((
  SELECT p.listing_type
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = o.id
  LIMIT 1
))
WHERE o.order_type = 'enquiry'
  AND COALESCE(o.transaction_type, '') NOT IN ('request_service', 'contact_enquiry');

UPDATE public.attribute_block_library
SET buyer_selectable = true
WHERE block_type IN ('variants', 'variant_rows', 'color_variants')
   OR block_key IN ('variants', 'variant_rows', 'color_variants');

-- Seed buyer-pickable option blocks. Admin can edit these later.
INSERT INTO public.attribute_block_library (
  block_key, block_type, display_name, description, icon, renderer_type,
  category_hints, applicable_categories, schema, default_config, display_order, is_active, buyer_selectable
)
SELECT v.block_key, v.block_type, v.display_name, v.description, v.icon, v.renderer_type,
       v.category_hints, v.category_hints, v.schema::jsonb, v.schema::jsonb, v.display_order, true, true
FROM (
  VALUES
  (
    'buyer_food_customization', 'buyer_food_customization', 'Food customization',
    'Spice, add-ons and removals buyers pick at checkout', '🌶️', 'tags',
    ARRAY['home_food','bakery','snacks','groceries','beverages','pet_food','other-food','other-food_beverages'],
    '{"fields":[{"key":"spice_level","label":"Spice level","type":"select","options":["Mild","Medium","Spicy","Extra spicy"]},{"key":"add_ons","label":"Add-ons","type":"tag_input"},{"key":"remove","label":"Remove / avoid","type":"tag_input"}]}',
    200
  ),
  (
    'buyer_appointment_visit', 'buyer_appointment_visit', 'Appointment options',
    'Visit type and concern for doctors, therapists and consultants', '🩺', 'tags',
    ARRAY['medical_specialist','ayurveda','tax_consultant','it_support','tutoring','resume_writing','coaching','other-professional'],
    '{"fields":[{"key":"visit_type","label":"Visit type","type":"select","options":["In-clinic","Home visit","Video consult","Follow-up"]},{"key":"concerns","label":"Concern / specialty","type":"tag_input"},{"key":"preferred_date","label":"Preferred date","type":"date"},{"key":"patient_notes","label":"Notes for the specialist","type":"textarea"}]}',
    201
  ),
  (
    'buyer_home_job', 'buyer_home_job', 'Job details',
    'Appliance, issue and urgency for home services', '🔧', 'tags',
    ARRAY['electrician','plumber','carpenter','ac_service','pest_control','appliance_repair','maid','cook','driver','nanny','other-home_services','other-services','other-domestic_help'],
    '{"fields":[{"key":"item_type","label":"What needs work","type":"tag_input"},{"key":"issues","label":"Issue","type":"tag_input"},{"key":"urgency","label":"Urgency","type":"select","options":["Flexible","Today","Emergency"]},{"key":"preferred_date","label":"Preferred date","type":"date"},{"key":"access_notes","label":"Access / landmark notes","type":"textarea"}]}',
    202
  ),
  (
    'buyer_salon_style', 'buyer_salon_style', 'Salon & grooming options',
    'Add-ons and preferences for salon, beauty and tailoring', '💇', 'tags',
    ARRAY['beauty','salon','mehendi','laundry','tailoring','other-personal','other-personal_care'],
    '{"fields":[{"key":"add_ons","label":"Add-ons","type":"tag_input"},{"key":"hair_or_skin","label":"Hair / skin / fabric","type":"select","options":["Short","Medium","Long","Sensitive","Normal"]},{"key":"preference","label":"Style preference","type":"textarea"}]}',
    203
  ),
  (
    'buyer_class_slot', 'buyer_class_slot', 'Class preferences',
    'Level and format for music, fitness, tuition and classes', '🎓', 'tags',
    ARRAY['tuition','yoga','dance','music','art_craft','language','fitness','coaching','daycare','other-classes','other-education_learning'],
    '{"fields":[{"key":"level","label":"Level","type":"select","options":["Beginner","Intermediate","Advanced","Trial"]},{"key":"format","label":"Format","type":"select","options":["1:1","Group","Home visit","Online"]},{"key":"goal","label":"What do you want to learn?","type":"textarea"}]}',
    204
  ),
  (
    'buyer_apparel_options', 'buyer_apparel_options', 'Size & style',
    'Buyer picks for clothing and resale fashion', '👕', 'tags',
    ARRAY['clothing','other-resale'],
    '{"fields":[{"key":"size","label":"Size","type":"select","options":["XS","S","M","L","XL","XXL","Custom"]},{"key":"color","label":"Color","type":"tag_input"},{"key":"fit_notes","label":"Fit or print notes","type":"textarea"}]}',
    205
  ),
  (
    'buyer_pet_visit', 'buyer_pet_visit', 'Pet details',
    'Pet type and size for grooming and sitting', '🐾', 'tags',
    ARRAY['pet_grooming','pet_sitting','dog_walking','other-pets'],
    '{"fields":[{"key":"pet_type","label":"Pet","type":"select","options":["Dog","Cat","Bird","Other"]},{"key":"size","label":"Size","type":"select","options":["Small","Medium","Large"]},{"key":"notes","label":"Temperament / care notes","type":"textarea"}]}',
    206
  ),
  (
    'buyer_event_brief', 'buyer_event_brief', 'Event brief',
    'Event type and scale for catering and photography', '🎉', 'tags',
    ARRAY['catering','decoration','photography','dj_music','other-events'],
    '{"fields":[{"key":"event_type","label":"Event type","type":"select","options":["Birthday","Wedding","Pooja","Corporate","Other"]},{"key":"guest_count","label":"Guest count","type":"select","options":["1-20","21-50","51-100","100+"]},{"key":"brief","label":"Brief","type":"textarea"}]}',
    207
  ),
  (
    'buyer_rental_need', 'buyer_rental_need', 'Rental needs',
    'Duration and delivery for equipment and vehicles', '🧰', 'tags',
    ARRAY['equipment_rental','vehicle_rental','party_supplies','baby_gear','other-rentals'],
    '{"fields":[{"key":"duration","label":"Duration","type":"select","options":["Hourly","Half day","Full day","Weekend","Weekly"]},{"key":"delivery","label":"Need delivery?","type":"boolean"},{"key":"notes","label":"Usage notes","type":"textarea"}]}',
    208
  ),
  (
    'buyer_property_visit', 'buyer_property_visit', 'Visit preferences',
    'Preferred slot and party size for property and resale visits', '🏠', 'tags',
    ARRAY['flat_rent','roommate','parking','furniture','electronics','books','toys','kitchen','other-property','other-resale'],
    '{"fields":[{"key":"visit_window","label":"Preferred visit","type":"select","options":["Weekday morning","Weekday evening","Weekend","Flexible"]},{"key":"party_size","label":"Who is visiting","type":"select","options":["Just me","Couple","Family","With agent"]},{"key":"questions","label":"Questions for the seller","type":"textarea"}]}',
    209
  )
) AS v(block_key, block_type, display_name, description, icon, renderer_type, category_hints, schema, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.attribute_block_library existing
  WHERE existing.block_type = v.block_type OR existing.block_key = v.block_key
);

INSERT INTO public.attribute_block_library (
  block_key, block_type, display_name, description, icon, renderer_type,
  category_hints, applicable_categories, schema, default_config, display_order, is_active, buyer_selectable
)
SELECT
  'buyer_custom_options',
  'buyer_custom_options',
  'Buyer options',
  'Reusable chips and notes any seller can offer — admin can rename or add more later',
  '✨',
  'tags',
  ARRAY(SELECT category FROM public.category_config ORDER BY category),
  ARRAY(SELECT category FROM public.category_config ORDER BY category),
  '{"fields":[{"key":"options","label":"Options buyers can pick","type":"tag_input","placeholder":"e.g. Extra cheese, AC split, Hair spa"},{"key":"quantity_note","label":"Quantity / size note","type":"text"},{"key":"notes","label":"Anything else","type":"textarea"}]}'::jsonb,
  '{"fields":[{"key":"options","label":"Options buyers can pick","type":"tag_input","placeholder":"e.g. Extra cheese, AC split, Hair spa"},{"key":"quantity_note","label":"Quantity / size note","type":"text"},{"key":"notes","label":"Anything else","type":"textarea"}]}'::jsonb,
  210,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.attribute_block_library existing
  WHERE existing.block_type = 'buyer_custom_options' OR existing.block_key = 'buyer_custom_options'
);
