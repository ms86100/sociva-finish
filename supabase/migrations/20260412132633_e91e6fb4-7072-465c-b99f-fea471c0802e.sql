
DO $$
DECLARE
  v_society_id uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user1 uuid := '2098a5b4-ccb4-4f56-ae71-51e59b8b5c7f';
  v_user2 uuid := 'b3220352-30c5-4d23-98b1-f0911074f444';
  v_user3 uuid := '6b7d338f-5dff-411e-b54d-7d4d081dbd2b';
  s_meera uuid := 'c1000000-0000-0000-0000-000000000001';
  s_greenleaf uuid := 'c1000000-0000-0000-0000-000000000002';
  s_ananya uuid := 'c1000000-0000-0000-0000-000000000003';
  s_ayurveda uuid := 'b9914568-df7b-4223-aeea-9828a078039e';
  s_dabbas uuid := '68a6cc09-50a7-4c62-a4c5-09a56a62f2bd';
  v_banner_id uuid := 'd1000000-0000-0000-0000-000000000001';
  v_sec1 uuid := 'd2000000-0000-0000-0000-000000000001';
  v_sec2 uuid := 'd2000000-0000-0000-0000-000000000002';
  v_sec3 uuid := 'd2000000-0000-0000-0000-000000000003';
  v_sec4 uuid := 'd2000000-0000-0000-0000-000000000004';
BEGIN

INSERT INTO seller_profiles (id, user_id, business_name, description, categories, is_available, verification_status, society_id, seller_type, rating, total_reviews, operating_days, fulfillment_mode, sell_beyond_community, delivery_radius_km, accepts_cod, accepts_upi, primary_group, completed_order_count, avg_preparation_time)
VALUES
  (s_meera, v_user1, 'Meera''s Kitchen', 'Authentic home-cooked meals & fresh bakery items.', '{home_food,bakery,snacks}', true, 'approved', v_society_id, 'society_resident', 4.7, 42, '{Mon,Tue,Wed,Thu,Fri,Sat}', 'seller_delivery', false, 5, true, true, 'food', 156, 30),
  (s_greenleaf, v_user2, 'GreenLeaf Home Services', 'Trusted plumbing, electrical & carpentry.', '{plumber,electrician,carpenter}', true, 'approved', v_society_id, 'society_resident', 4.5, 28, '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}', 'self_pickup', false, 10, true, true, 'services', 89, 60),
  (s_ananya, v_user3, 'Ananya''s Boutique', 'Handcrafted clothing, tailoring & mehendi.', '{clothing,tailoring,mehendi}', true, 'approved', v_society_id, 'society_resident', 4.8, 35, '{Mon,Tue,Wed,Thu,Fri,Sat}', 'self_pickup', false, 5, true, true, 'goods', 112, 45)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (seller_id, name, description, price, mrp, category, is_veg, is_available, is_bestseller, approval_status, action_type, stock_quantity, low_stock_threshold, society_id, cuisine_type, prep_time_minutes) VALUES
  (s_meera, 'Bengali Fish Curry', 'Traditional rohu fish curry. Serves 2.', 180, 220, 'home_food', false, true, true, 'approved', 'buy_now', 15, 3, v_society_id, 'Bengali', 25),
  (s_meera, 'Paneer Butter Masala', 'Rich paneer in cashew gravy. Serves 2.', 160, 200, 'home_food', true, true, true, 'approved', 'buy_now', 20, 5, v_society_id, 'North Indian', 20),
  (s_meera, 'Masala Dosa Platter', 'Crispy dosa set of 3 with sambar.', 120, 150, 'home_food', true, true, false, 'approved', 'buy_now', 12, 3, v_society_id, 'South Indian', 15),
  (s_meera, 'Chicken Biryani', 'Hyderabadi dum biryani. Serves 2-3.', 250, 320, 'home_food', false, true, true, 'approved', 'buy_now', 10, 2, v_society_id, 'Hyderabadi', 40),
  (s_meera, 'Fresh Chocolate Cake', 'Belgian chocolate cake. 500g.', 450, 550, 'bakery', true, true, false, 'approved', 'buy_now', 5, 2, v_society_id, NULL, 60),
  (s_meera, 'Banana Bread Loaf', 'Moist banana bread. 400g.', 180, 220, 'bakery', true, true, false, 'approved', 'buy_now', 8, 2, v_society_id, NULL, 45),
  (s_meera, 'Samosa Pack (6 pcs)', 'Crispy samosas with chutney.', 90, 120, 'snacks', true, true, true, 'approved', 'buy_now', 25, 5, v_society_id, 'North Indian', 20),
  (s_meera, 'Meethi Mathri Box', 'Sweet crispy mathri. 250g.', 80, 100, 'snacks', true, true, false, 'approved', 'buy_now', 15, 3, v_society_id, NULL, 30),
  (s_meera, 'Dal Makhani Bowl', 'Slow-cooked black lentils. Serves 2.', 140, 170, 'home_food', true, true, false, 'approved', 'buy_now', 12, 3, v_society_id, 'Punjabi', 35),
  (s_meera, 'Gulab Jamun (12 pcs)', 'Soft gulab jamuns in rose syrup.', 200, 250, 'snacks', true, true, true, 'approved', 'buy_now', 10, 2, v_society_id, NULL, 45);

INSERT INTO products (seller_id, name, description, price, category, is_available, is_bestseller, approval_status, action_type, stock_quantity, society_id, service_duration_minutes, minimum_charge) VALUES
  (s_greenleaf, 'Tap & Faucet Repair', 'Fix leaky taps or install new faucets.', 250, 'plumber', true, true, 'approved', 'book', 50, v_society_id, 45, 200),
  (s_greenleaf, 'Toilet Flush Repair', 'Fix or replace flush mechanisms.', 350, 'plumber', true, false, 'approved', 'book', 50, v_society_id, 60, 300),
  (s_greenleaf, 'Kitchen Sink Unclog', 'Professional drain cleaning.', 400, 'plumber', true, true, 'approved', 'book', 50, v_society_id, 30, 350),
  (s_greenleaf, 'Fan Installation', 'Ceiling fan install with wiring.', 300, 'electrician', true, true, 'approved', 'book', 50, v_society_id, 45, 250),
  (s_greenleaf, 'Switchboard Repair', 'Fix faulty switches.', 200, 'electrician', true, false, 'approved', 'book', 50, v_society_id, 30, 150),
  (s_greenleaf, 'LED Light Setup', 'Install LED panels or strips.', 500, 'electrician', true, false, 'approved', 'book', 50, v_society_id, 60, 400),
  (s_greenleaf, 'Door Hinge Fix', 'Repair or replace hinges.', 200, 'carpenter', true, false, 'approved', 'book', 50, v_society_id, 30, 150),
  (s_greenleaf, 'Furniture Assembly', 'Assemble flat-pack furniture.', 400, 'carpenter', true, true, 'approved', 'book', 50, v_society_id, 90, 350),
  (s_greenleaf, 'Window Lock Repair', 'Fix window locks.', 250, 'carpenter', true, false, 'approved', 'book', 50, v_society_id, 30, 200),
  (s_greenleaf, 'Full Bathroom Checkup', 'Complete plumbing inspection.', 600, 'plumber', true, true, 'approved', 'book', 50, v_society_id, 90, 500);

INSERT INTO products (seller_id, name, description, price, mrp, category, is_available, is_bestseller, approval_status, action_type, stock_quantity, low_stock_threshold, society_id) VALUES
  (s_ananya, 'Hand-Embroidered Kurti', 'Cotton chikankari kurti. S-XL.', 850, 1200, 'clothing', true, true, 'approved', 'buy_now', 8, 2, v_society_id),
  (s_ananya, 'Block Print Dupatta', 'Ajrakh dupatta. 2.5m.', 350, 450, 'clothing', true, false, 'approved', 'buy_now', 15, 3, v_society_id),
  (s_ananya, 'Saree Blouse Stitching', 'Custom blouse. 5-day.', 500, NULL, 'tailoring', true, true, 'approved', 'book', 50, 5, v_society_id),
  (s_ananya, 'Kurti Alteration', 'Fitting modification.', 150, NULL, 'tailoring', true, false, 'approved', 'book', 50, 5, v_society_id),
  (s_ananya, 'Bridal Mehendi', 'Full bridal. 3-4 hours.', 2500, 3500, 'mehendi', true, true, 'approved', 'book', 50, 5, v_society_id),
  (s_ananya, 'Party Mehendi', 'Party mehendi. 1-2 hours.', 800, 1000, 'mehendi', true, true, 'approved', 'book', 50, 5, v_society_id),
  (s_ananya, 'Kids Festival Outfit', 'Kurta-pajama. Ages 3-10.', 600, 850, 'clothing', true, false, 'approved', 'buy_now', 10, 2, v_society_id),
  (s_ananya, 'Jute Tote Bag', 'Eco-friendly jute bag.', 250, 350, 'clothing', true, false, 'approved', 'buy_now', 20, 5, v_society_id),
  (s_ananya, 'Palazzo Stitching', 'Custom palazzo pants.', 300, NULL, 'tailoring', true, false, 'approved', 'book', 50, 5, v_society_id),
  (s_ananya, 'Quick Mehendi', 'One hand. 30 min.', 300, 400, 'mehendi', true, false, 'approved', 'book', 50, 5, v_society_id);

INSERT INTO products (seller_id, name, description, price, mrp, category, is_available, is_bestseller, approval_status, action_type, stock_quantity, low_stock_threshold, society_id, service_duration_minutes) VALUES
  (s_ayurveda, 'Full Body Oil Massage', '60-min Ayurvedic massage.', 800, 1200, 'ayurveda', true, true, 'approved', 'book', 50, 5, v_society_id, 60),
  (s_ayurveda, 'Head & Shoulder Massage', '30-min head massage.', 400, 500, 'ayurveda', true, false, 'approved', 'book', 50, 5, v_society_id, 30),
  (s_ayurveda, 'Ayurvedic Face Pack', 'Turmeric treatment.', 350, 450, 'ayurveda', true, false, 'approved', 'book', 50, 5, v_society_id, 45),
  (s_ayurveda, 'Joint Pain Relief', 'Herbal therapy. 45 min.', 600, 800, 'ayurveda', true, true, 'approved', 'book', 50, 5, v_society_id, 45),
  (s_ayurveda, 'Herbal Hair Oil', 'Bhringraj hair oil. 200ml.', 250, 350, 'ayurveda', true, false, 'approved', 'buy_now', 20, 5, v_society_id, NULL),
  (s_ayurveda, 'Immunity Kadha Mix', 'Herbal immunity mix.', 180, 250, 'ayurveda', true, true, 'approved', 'buy_now', 30, 5, v_society_id, NULL),
  (s_ayurveda, 'Postpartum Care', '7-day new mother care.', 1500, 2000, 'ayurveda', true, false, 'approved', 'book', 50, 5, v_society_id, 60);

INSERT INTO products (seller_id, name, description, price, mrp, category, is_veg, is_available, is_bestseller, approval_status, action_type, stock_quantity, low_stock_threshold, society_id, cuisine_type, prep_time_minutes) VALUES
  (s_dabbas, 'Veg Thali (Full)', 'Dal, sabzi, roti, rice.', 120, 150, 'home_food', true, true, true, 'approved', 'buy_now', 20, 5, v_society_id, 'North Indian', 20),
  (s_dabbas, 'Non-Veg Thali', 'Chicken curry, dal, roti.', 160, 200, 'home_food', false, true, true, 'approved', 'buy_now', 15, 3, v_society_id, 'North Indian', 25),
  (s_dabbas, 'Egg Curry & Rice', 'Egg curry with basmati.', 100, 130, 'home_food', false, true, false, 'approved', 'buy_now', 18, 3, v_society_id, 'Bengali', 15),
  (s_dabbas, 'Chole Bhature', 'Bhature with spicy chole.', 90, 120, 'home_food', true, true, false, 'approved', 'buy_now', 12, 3, v_society_id, 'Punjabi', 15),
  (s_dabbas, 'Butter Chicken Bowl', 'Butter chicken with rice.', 180, 230, 'home_food', false, true, true, 'approved', 'buy_now', 10, 2, v_society_id, 'Punjabi', 25),
  (s_dabbas, 'Palak Paneer & Naan', 'Spinach paneer with naans.', 150, 190, 'home_food', true, true, false, 'approved', 'buy_now', 12, 3, v_society_id, 'North Indian', 20),
  (s_dabbas, 'Weekend Mutton Biryani', 'Sat-Sun special. Serves 2.', 350, 450, 'home_food', false, true, true, 'approved', 'buy_now', 6, 2, v_society_id, 'Hyderabadi', 50),
  (s_dabbas, 'Breakfast Paratha Pack', '4 parathas with curd.', 110, 140, 'home_food', true, true, false, 'approved', 'buy_now', 15, 3, v_society_id, 'Punjabi', 20);

INSERT INTO coupons (seller_id, society_id, code, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, per_user_limit, is_active, starts_at, expires_at, description, show_to_buyers) VALUES
  (s_meera, v_society_id, 'MEERA20', 'percentage', 20, 200, 100, 50, 2, true, now(), now() + interval '30 days', '20% off above ₹200', true),
  (s_dabbas, v_society_id, 'DABBA50', 'flat', 50, 150, 50, 100, 3, true, now(), now() + interval '15 days', '₹50 off above ₹150', true),
  (s_ananya, v_society_id, 'FESTIVE15', 'percentage', 15, 500, 200, 30, 1, true, now(), now() + interval '45 days', '15% off festival outfits', true);

-- Banner uses type='banner' to pass check constraint
INSERT INTO featured_items (id, type, reference_id, title, subtitle, banner_type, status, is_active, display_order, society_id, badge_text, theme_preset, theme_config, animation_config)
VALUES (v_banner_id, 'banner', 'diwali-2026', '✨ Diwali Celebrations', 'Shop festive treats, decor & gifts from your neighbors', 'festival', 'published', true, 0, v_society_id, '🪔 Diwali Special', 'diwali', '{"bg":"#FFD700","gradient":["#FFD700","#FF8C00","#B8860B"]}', '{"type":"shimmer","intensity":"moderate"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO banner_sections (id, banner_id, title, icon_emoji, icon_color, display_order, product_source_type, product_source_value) VALUES
  (v_sec1, v_banner_id, 'Sweets & Mithai', 'anim:food', '#FBBF24', 0, 'category', 'snacks'),
  (v_sec2, v_banner_id, 'Festive Fashion', 'anim:gift', '#FB7185', 1, 'category', 'clothing'),
  (v_sec3, v_banner_id, 'Mehendi & Beauty', 'anim:craft', '#F472B6', 2, 'category', 'mehendi'),
  (v_sec4, v_banner_id, 'Home Services', 'anim:tools', '#38BDF8', 3, 'category', 'plumber')
ON CONFLICT (id) DO NOTHING;

INSERT INTO festival_seller_participation (banner_id, seller_id, opted_in) VALUES
  (v_banner_id, s_meera, true), (v_banner_id, s_dabbas, true), (v_banner_id, s_ananya, true), (v_banner_id, s_ayurveda, true), (v_banner_id, s_greenleaf, true),
  ('b9cc2cfa-c1e1-4499-a477-a176ca950681', s_meera, true), ('b9cc2cfa-c1e1-4499-a477-a176ca950681', s_dabbas, true), ('b9cc2cfa-c1e1-4499-a477-a176ca950681', s_ananya, true), ('b9cc2cfa-c1e1-4499-a477-a176ca950681', s_ayurveda, true), ('b9cc2cfa-c1e1-4499-a477-a176ca950681', s_greenleaf, true)
ON CONFLICT DO NOTHING;

END;
$$;
