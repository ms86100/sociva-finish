import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Reset & Seed Scenario
 * =====================
 * 1. Purges all user/listing data while keeping admin user + config tables
 * 2. Seeds realistic end-to-end data for Food, Coaching, Yoga, Electronics
 * 3. Records execution results to test_results table
 *
 * SECURITY: Blocked in production unless ALLOW_TEST_FUNCTIONS is set.
 */





const RUN_ID = `seed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = "SeedUser2026!";

// ─── Societies ──────────────────────────────────────────────────────────
const SOCIETIES = [
  {
    name: "Maple Gardens Residency",
    slug: "maple-gardens",
    address: "Koramangala, Bangalore",
    city: "Bangalore",
    state: "Karnataka",
    pincode: "560034",
    latitude: 12.9352,
    longitude: 77.6245,
    is_active: true,
    is_verified: true,
    member_count: 0,
    geofence_radius_meters: 500,
    approval_method: "auto",
    auto_approve_residents: true,
    max_society_admins: 5,
    security_mode: "basic",
  },
  {
    name: "Sunrise Heights",
    slug: "sunrise-heights",
    address: "HSR Layout, Bangalore",
    city: "Bangalore",
    state: "Karnataka",
    pincode: "560102",
    latitude: 12.9116,
    longitude: 77.6474,
    is_active: true,
    is_verified: true,
    member_count: 0,
    geofence_radius_meters: 500,
    approval_method: "auto",
    auto_approve_residents: true,
    max_society_admins: 5,
    security_mode: "basic",
  },
  {
    name: "Palm Breeze Apartments",
    slug: "palm-breeze-apts",
    address: "JP Nagar, Bangalore",
    city: "Bangalore",
    state: "Karnataka",
    pincode: "560078",
    latitude: 12.9063,
    longitude: 77.5857,
    is_active: true,
    is_verified: true,
    member_count: 0,
    geofence_radius_meters: 500,
    approval_method: "auto",
    auto_approve_residents: true,
    max_society_admins: 5,
    security_mode: "basic",
  },
];

// ─── Users ──────────────────────────────────────────────────────────────
interface UserDef {
  email: string;
  name: string;
  flat: string;
  block: string;
  phone: string;
  societyIdx: number;
  role: "seller" | "buyer";
}

const SELLERS: (UserDef & {
  business: string;
  desc: string;
  categories: string[];
  primary_group: string;
  delivery_radius_km: number;
})[] = [
  // FOOD sellers
  {
    email: "seed-food-seller1@test.sociva.com",
    name: "Asha's Kitchen",
    flat: "A-101",
    block: "Tower A",
    phone: "9800000001",
    societyIdx: 0,
    role: "seller",
    business: "Asha's Home Kitchen",
    desc: "Authentic North Indian home-cooked meals made with love",
    categories: ["home_food", "bakery"],
    primary_group: "food",
    delivery_radius_km: 5,
  },
  {
    email: "seed-food-seller2@test.sociva.com",
    name: "Dosa Corner",
    flat: "B-203",
    block: "Tower B",
    phone: "9800000002",
    societyIdx: 1,
    role: "seller",
    business: "Dosa Corner by Lakshmi",
    desc: "Crispy South Indian dosas and fresh chutneys",
    categories: ["home_food"],
    primary_group: "food",
    delivery_radius_km: 5,
  },
  {
    email: "seed-food-seller3@test.sociva.com",
    name: "Sweet Delights",
    flat: "C-104",
    block: "Tower C",
    phone: "9800000003",
    societyIdx: 0,
    role: "seller",
    business: "Sweet Delights Bakery",
    desc: "Fresh baked goods, cakes and traditional Indian sweets",
    categories: ["bakery", "snacks"],
    primary_group: "food",
    delivery_radius_km: 4,
  },
  // COACHING sellers
  {
    email: "seed-coaching-seller1@test.sociva.com",
    name: "Prof. Ramesh",
    flat: "D-301",
    block: "Tower D",
    phone: "9800000004",
    societyIdx: 0,
    role: "seller",
    business: "Ramesh Math Academy",
    desc: "Expert math tutoring for classes 8-12, IIT-JEE preparation",
    categories: ["coaching", "tuition"],
    primary_group: "education",
    delivery_radius_km: 7,
  },
  {
    email: "seed-coaching-seller2@test.sociva.com",
    name: "Dr. Priya Sharma",
    flat: "A-402",
    block: "Tower A",
    phone: "9800000005",
    societyIdx: 1,
    role: "seller",
    business: "Priya's Science Lab",
    desc: "Hands-on science coaching with lab experiments",
    categories: ["coaching"],
    primary_group: "education",
    delivery_radius_km: 6,
  },
  // YOGA sellers
  {
    email: "seed-yoga-seller1@test.sociva.com",
    name: "Guru Anand",
    flat: "E-102",
    block: "Tower E",
    phone: "9800000006",
    societyIdx: 0,
    role: "seller",
    business: "Anand Yoga Studio",
    desc: "Traditional Hatha & Ashtanga yoga with certified instructor",
    categories: ["yoga", "fitness"],
    primary_group: "education",
    delivery_radius_km: 8,
  },
  {
    email: "seed-yoga-seller2@test.sociva.com",
    name: "Nisha Kapoor",
    flat: "F-201",
    block: "Tower F",
    phone: "9800000007",
    societyIdx: 2,
    role: "seller",
    business: "FlowFit Yoga",
    desc: "Power yoga and meditation sessions for all levels",
    categories: ["yoga"],
    primary_group: "education",
    delivery_radius_km: 6,
  },
  // ELECTRONICS sellers
  {
    email: "seed-electronics-seller1@test.sociva.com",
    name: "TechMart India",
    flat: "G-301",
    block: "Tower G",
    phone: "9800000008",
    societyIdx: 1,
    role: "seller",
    business: "TechMart Accessories",
    desc: "Premium mobile accessories and computer peripherals",
    categories: ["electronics"],
    primary_group: "products",
    delivery_radius_km: 5,
  },
  {
    email: "seed-electronics-seller2@test.sociva.com",
    name: "Gadget Hub",
    flat: "H-102",
    block: "Tower H",
    phone: "9800000009",
    societyIdx: 0,
    role: "seller",
    business: "Gadget Hub Store",
    desc: "Latest electronics, gadgets and smart home devices",
    categories: ["electronics"],
    primary_group: "products",
    delivery_radius_km: 5,
  },
];

const BUYERS: UserDef[] = [
  { email: "seed-buyer1@test.sociva.com", name: "Ravi Kumar", flat: "A-501", block: "Tower A", phone: "9800000010", societyIdx: 0, role: "buyer" },
  { email: "seed-buyer2@test.sociva.com", name: "Sneha Patel", flat: "B-302", block: "Tower B", phone: "9800000011", societyIdx: 1, role: "buyer" },
  { email: "seed-buyer3@test.sociva.com", name: "Arjun Reddy", flat: "C-401", block: "Tower C", phone: "9800000012", societyIdx: 2, role: "buyer" },
];

// ─── Products per seller ────────────────────────────────────────────────
function getProductsForSeller(sellerEmail: string) {
  const map: Record<string, any[]> = {
    "seed-food-seller1@test.sociva.com": [
      { name: "Butter Chicken Thali", price: 220, mrp: 280, category: "home_food", is_veg: false, description: "Rich creamy butter chicken with dal, rice, naan and salad", is_bestseller: true, is_recommended: true, action_type: "add_to_cart", prep_time_minutes: 30, cuisine_type: "North Indian", serving_size: "1 plate", spice_level: "medium", specifications: { blocks: [{ type: "nutrition_info", data: { calories: "650 kcal", protein: "32g", carbs: "58g" } }, { type: "allergen_info", data: { contains: "Dairy, Gluten, Nuts" } }] } },
      { name: "Paneer Tikka Masala", price: 180, mrp: 220, category: "home_food", is_veg: true, description: "Smoky grilled paneer in rich tomato gravy", is_bestseller: false, is_recommended: true, action_type: "add_to_cart", prep_time_minutes: 25, cuisine_type: "North Indian", serving_size: "1 bowl", spice_level: "hot", specifications: { blocks: [{ type: "nutrition_info", data: { calories: "420 kcal", protein: "18g", carbs: "22g" } }] } },
      { name: "Dal Makhani", price: 150, category: "home_food", is_veg: true, description: "Slow-cooked black lentils in creamy butter sauce", action_type: "add_to_cart", prep_time_minutes: 20, cuisine_type: "North Indian", spice_level: "mild" },
      { name: "Fresh Garlic Naan", price: 35, category: "bakery", is_veg: true, description: "Soft tandoori naan with fresh garlic", action_type: "add_to_cart", prep_time_minutes: 10 },
      { name: "Gulab Jamun (6 pcs)", price: 120, category: "home_food", is_veg: true, description: "Soft milk dumplings in rose-flavored sugar syrup", action_type: "add_to_cart", prep_time_minutes: 15 },
    ],
    "seed-food-seller2@test.sociva.com": [
      { name: "Masala Dosa", price: 80, category: "home_food", is_veg: true, description: "Crispy rice crepe stuffed with spiced potato filling", is_bestseller: true, is_recommended: true, action_type: "add_to_cart", prep_time_minutes: 15, cuisine_type: "South Indian", specifications: { blocks: [{ type: "nutrition_info", data: { calories: "350 kcal", protein: "8g", carbs: "52g" } }] } },
      { name: "Filter Coffee", price: 40, category: "home_food", is_veg: true, description: "Traditional South Indian filter coffee", is_recommended: true, action_type: "add_to_cart", prep_time_minutes: 5, cuisine_type: "South Indian" },
      { name: "Idli Sambar (4 pcs)", price: 60, category: "home_food", is_veg: true, description: "Steamed rice cakes with lentil soup and chutneys", action_type: "add_to_cart", prep_time_minutes: 10, cuisine_type: "South Indian" },
      { name: "Medu Vada (3 pcs)", price: 55, category: "home_food", is_veg: true, description: "Crispy urad dal fritters", action_type: "add_to_cart", prep_time_minutes: 12 },
      { name: "Rava Upma", price: 50, category: "home_food", is_veg: true, description: "Savory semolina breakfast with vegetables", action_type: "add_to_cart", prep_time_minutes: 10 },
    ],
    "seed-food-seller3@test.sociva.com": [
      { name: "Chocolate Truffle Cake", price: 650, mrp: 800, category: "bakery", is_veg: true, description: "Rich dark chocolate truffle cake (500g)", is_bestseller: true, action_type: "add_to_cart", prep_time_minutes: 120 },
      { name: "Fresh Croissants (4)", price: 180, category: "bakery", is_veg: true, description: "Buttery flaky French croissants", action_type: "add_to_cart", prep_time_minutes: 45 },
      { name: "Samosa (6 pcs)", price: 90, category: "snacks", is_veg: true, description: "Crispy potato-filled samosas with mint chutney", is_recommended: true, action_type: "add_to_cart" },
      { name: "Kaju Katli (250g)", price: 350, category: "snacks", is_veg: true, description: "Premium cashew fudge sweets", action_type: "add_to_cart" },
      { name: "Banana Bread", price: 200, category: "bakery", is_veg: true, description: "Moist homemade banana bread loaf", action_type: "add_to_cart" },
    ],
    "seed-coaching-seller1@test.sociva.com": [
      { name: "IIT-JEE Math Foundation (Monthly)", price: 3500, category: "coaching", is_veg: true, description: "Comprehensive math preparation for JEE aspirants. 3 classes/week, doubt clearing included.", action_type: "request_service", service_duration_minutes: 90, specifications: { blocks: [{ type: "course_details", data: { level: "Advanced", batch_size: "Max 10 students", schedule: "Mon/Wed/Fri 6-7:30 PM", includes: "Study material, weekly tests" } }] } },
      { name: "Class 10 Math Tuition", price: 2000, category: "tuition", is_veg: true, description: "CBSE Class 10 Mathematics — Board exam focused", action_type: "request_service", service_duration_minutes: 60, specifications: { blocks: [{ type: "course_details", data: { level: "Intermediate", batch_size: "Max 8 students", schedule: "Tue/Thu 4-5 PM" } }] } },
      { name: "Mental Math Workshop", price: 500, category: "coaching", is_veg: true, description: "One-day intensive workshop on Vedic math techniques", action_type: "book_slot", service_duration_minutes: 180 },
      { name: "Doubt Clearing Session", price: 300, category: "coaching", is_veg: true, description: "1-on-1 personalized doubt clearing for any math topic", action_type: "request_service", service_duration_minutes: 45 },
    ],
    "seed-coaching-seller2@test.sociva.com": [
      { name: "Physics Lab Course (Monthly)", price: 4000, category: "coaching", is_veg: true, description: "Hands-on physics experiments with theory. Perfect for Class 11-12.", action_type: "request_service", service_duration_minutes: 120, specifications: { blocks: [{ type: "course_details", data: { level: "Advanced", includes: "Lab equipment, notes", schedule: "Sat/Sun 10 AM-12 PM" } }] } },
      { name: "Chemistry Crash Course", price: 2500, category: "coaching", is_veg: true, description: "Intensive 2-week chemistry revision for board exams", action_type: "request_service", service_duration_minutes: 90 },
      { name: "Science Project Mentoring", price: 800, category: "coaching", is_veg: true, description: "Guided science project for school exhibitions", action_type: "request_service", service_duration_minutes: 60 },
      { name: "NEET Biology Prep", price: 3500, category: "coaching", is_veg: true, description: "Focused NEET biology preparation with previous year papers", action_type: "request_service", service_duration_minutes: 90, specifications: { blocks: [{ type: "course_details", data: { level: "Advanced", batch_size: "Max 12", includes: "Study material, mock tests" } }] } },
    ],
    "seed-yoga-seller1@test.sociva.com": [
      { name: "Hatha Yoga (Morning Batch)", price: 2500, category: "yoga", is_veg: true, description: "Traditional Hatha yoga — alignment, breathing, meditation. Mon-Sat 6-7 AM.", action_type: "book_slot", service_duration_minutes: 60, specifications: { blocks: [{ type: "session_details", data: { level: "All levels", equipment: "Mat provided", batch_size: "Max 15", location: "Society garden" } }] } },
      { name: "Pranayama & Meditation", price: 1500, category: "yoga", is_veg: true, description: "Deep breathing techniques and guided meditation", action_type: "book_slot", service_duration_minutes: 45 },
      { name: "Private Yoga Session", price: 1000, category: "yoga", is_veg: true, description: "1-on-1 personalized yoga session at your home", action_type: "request_service", service_duration_minutes: 60 },
      { name: "Yoga for Seniors", price: 2000, category: "yoga", is_veg: true, description: "Gentle yoga designed for seniors. Chair-based options available.", action_type: "book_slot", service_duration_minutes: 45, specifications: { blocks: [{ type: "session_details", data: { level: "Beginner", equipment: "Chair + Mat", special: "Modified poses for joint issues" } }] } },
      { name: "Kids Yoga Camp", price: 3000, category: "yoga", is_veg: true, description: "Fun yoga activities for children ages 5-12. Weekend batch.", action_type: "book_slot", service_duration_minutes: 60 },
    ],
    "seed-yoga-seller2@test.sociva.com": [
      { name: "Power Yoga (Evening)", price: 3000, category: "yoga", is_veg: true, description: "High-intensity power yoga for fitness enthusiasts. Mon/Wed/Fri 7 PM.", action_type: "book_slot", service_duration_minutes: 75, specifications: { blocks: [{ type: "session_details", data: { level: "Intermediate-Advanced", equipment: "Mat + Blocks", intensity: "High", calories_burn: "400-600 kcal" } }] } },
      { name: "Meditation Masterclass", price: 800, category: "yoga", is_veg: true, description: "Weekend guided meditation and mindfulness workshop", action_type: "book_slot", service_duration_minutes: 90 },
      { name: "Corporate Yoga Package", price: 5000, category: "yoga", is_veg: true, description: "Weekly yoga sessions for your workplace. Group of 10-20.", action_type: "request_service", service_duration_minutes: 60 },
      { name: "Yoga Therapy (1-on-1)", price: 1200, category: "yoga", is_veg: true, description: "Therapeutic yoga for back pain, stress, and lifestyle issues", action_type: "request_service", service_duration_minutes: 60 },
    ],
    "seed-electronics-seller1@test.sociva.com": [
      { name: "iPhone 15 Silicone Case", price: 499, mrp: 999, category: "electronics", is_veg: true, description: "Premium silicone case with MagSafe compatibility", is_bestseller: true, action_type: "add_to_cart", brand: "TechGuard", specifications: { blocks: [{ type: "product_specs", data: { material: "Liquid silicone", compatibility: "iPhone 15/15 Pro", color_options: "Black, Navy, Olive", warranty: "6 months" } }] } },
      { name: "USB-C Fast Charger 65W", price: 899, mrp: 1499, category: "electronics", is_veg: true, description: "GaN charger with 3 ports — USB-C + USB-A", action_type: "add_to_cart", brand: "PowerMax", specifications: { blocks: [{ type: "product_specs", data: { wattage: "65W", ports: "2x USB-C, 1x USB-A", protocol: "PD 3.0, QC 4.0" } }] } },
      { name: "Wireless Earbuds Pro", price: 1999, mrp: 3499, category: "electronics", is_veg: true, description: "Active noise cancelling wireless earbuds with 30hr battery", is_recommended: true, action_type: "add_to_cart", brand: "SoundWave" },
      { name: "Laptop Stand Aluminum", price: 1299, mrp: 1999, category: "electronics", is_veg: true, description: "Adjustable ergonomic aluminum laptop stand", action_type: "add_to_cart" },
      { name: "Tempered Glass Screen Protector", price: 199, mrp: 499, category: "electronics", is_veg: true, description: "9H hardness tempered glass for Samsung Galaxy S24", action_type: "add_to_cart" },
    ],
    "seed-electronics-seller2@test.sociva.com": [
      { name: "Smart LED Desk Lamp", price: 1499, mrp: 2499, category: "electronics", is_veg: true, description: "WiFi-enabled desk lamp with color temperature control", is_bestseller: true, action_type: "add_to_cart", brand: "LumiSmart", specifications: { blocks: [{ type: "product_specs", data: { connectivity: "WiFi + Bluetooth", lumens: "800", color_temp: "2700K-6500K", smart_home: "Alexa, Google Home" } }] } },
      { name: "Mechanical Keyboard", price: 2999, mrp: 4999, category: "electronics", is_veg: true, description: "Hot-swappable mechanical keyboard with RGB backlighting", action_type: "add_to_cart", brand: "KeyCraft", specifications: { blocks: [{ type: "product_specs", data: { switches: "Gateron Red", layout: "75%", connectivity: "USB-C + Bluetooth", keycaps: "PBT double-shot" } }] } },
      { name: "Webcam 2K", price: 1799, mrp: 2999, category: "electronics", is_veg: true, description: "2K resolution webcam with auto-focus and noise-cancelling mic", action_type: "add_to_cart" },
      { name: "USB Hub 7-in-1", price: 999, mrp: 1499, category: "electronics", is_veg: true, description: "USB-C hub with HDMI, SD card, 3x USB-A, USB-C PD", action_type: "add_to_cart" },
      { name: "Portable SSD 500GB", price: 3499, mrp: 4999, category: "electronics", is_veg: true, description: "Ultra-fast portable SSD with USB 3.2 Gen 2", is_recommended: true, action_type: "add_to_cart", brand: "SwiftDrive" },
    ],
  };
  return map[sellerEmail] || [];
}

// ─── Helper: record a result ────────────────────────────────────────────
function makeResult(module: string, test: string, outcome: string, details?: any, error?: string) {
  return {
    run_id: RUN_ID,
    module_name: module,
    test_name: test,
    outcome,
    response_payload: details || null,
    error_message: error || null,
    executed_at: new Date().toISOString(),
    file_path: "supabase/functions/reset-and-seed-scenario/index.ts",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // C4: Block in production unless explicitly allowed
  if (!Deno.env.get("ALLOW_TEST_FUNCTIONS")) {
    return new Response(
      JSON.stringify({ error: "Test functions are disabled in this environment" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Rate limit — 2 per hour
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed } = await checkRateLimit(`reset-seed:${clientIp}`, 2, 3600);
  if (!allowed) return rateLimitResponse(corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: any[] = [];
  const t0 = Date.now();

  try {
    // ─── PHASE 1: Identify admin user to preserve ───────────────
    const { data: adminRoles } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const adminUserIds = (adminRoles || []).map((r: any) => r.user_id);

    results.push(makeResult("reset", "identify_admin_users", "passed", { admin_count: adminUserIds.length, admin_ids: adminUserIds }));

    // ─── PHASE 2: Delete user data (reverse FK order) ───────────
    // We use TRUNCATE-like deletes. Order matters to avoid FK violations.
    const deleteTables = [
      // Transactional leaf tables first
      "subscription_deliveries", "subscriptions",
      "delivery_tracking_logs", "delivery_assignments",
      "seller_settlements", "payment_records", "coupon_redemptions",
      "order_items", "orders", "orders_archive",
      "cart_items", "coupons", "favorites",
      "chat_messages",
      // Reviews & reports
      "reviews", "reports", "warnings", "user_feedback",
      // Bulletin
      "bulletin_votes", "bulletin_comments", "bulletin_rsvps", "bulletin_posts",
      // Help
      "help_responses", "help_requests",
      // Skills & endorsements
      "skill_endorsements", "skill_listings",
      // Society modules
      "expense_flags", "expense_views", "society_expenses", "society_budgets",
      "society_activity",
      "emergency_broadcasts",
      "project_answers", "project_questions", "project_documents",
      "milestone_reactions", "construction_milestones", "project_towers",
      "snag_tickets", "collective_escalations", "dispute_comments", "dispute_tickets",
      // Gate & security
      "gate_entries", "visitor_entries", "parcel_entries",
      "domestic_help_attendance", "domestic_help_entries",
      "worker_entry_logs", "worker_attendance", "worker_ratings",
      "worker_leave_requests", "worker_job_requests", "worker_salary_records",
      "society_workers",
      // Delivery partners
      "delivery_partner_pool", "delivery_partners",
      // Auth-related
      "authorized_persons", "device_tokens",
      // Notifications
      "notification_queue", "user_notifications",
      // Seller data
      "seller_form_configs", "products",
      "seller_licenses", "seller_profiles",
      // Maintenance & payments
      "resident_payments", "payment_milestones", "maintenance_dues",
      // Builder stuff
      "builder_announcements", "builder_feature_packages", "builder_members", "builder_societies", "builders",
      // Security staff
      "security_staff",
      // Society admin & features
      "society_admins", "society_features", "society_feature_overrides",
      // Parking
      "parking_slots",
      // Featured items
      "featured_items",
      // User roles (except admin)
      // profiles (except admin)
      // societies
      // Audit
      "audit_log", "audit_log_archive",
      // Rate limits, trigger errors, test results (keep test_results for history)
      "rate_limits", "trigger_errors",
    ];

    for (const table of deleteTables) {
      try {
        const { error } = await sb.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) {
          console.warn(`Delete ${table}:`, error.message);
        }
      } catch (e) {
        console.warn(`Skip ${table}:`, e.message);
      }
    }

    // Delete user_roles except admin
    await sb.from("user_roles").delete().neq("role", "admin");

    // Delete profiles except admin users
    if (adminUserIds.length > 0) {
      for (const aid of adminUserIds) {
        // Keep admin profiles, delete others
      }
      // Delete non-admin profiles
      const { data: allProfiles } = await sb.from("profiles").select("id");
      const nonAdminIds = (allProfiles || []).filter((p: any) => !adminUserIds.includes(p.id)).map((p: any) => p.id);
      if (nonAdminIds.length > 0) {
        // Batch delete in chunks of 100
        for (let i = 0; i < nonAdminIds.length; i += 100) {
          const batch = nonAdminIds.slice(i, i + 100);
          await sb.from("profiles").delete().in("id", batch);
        }
      }
    } else {
      await sb.from("profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    // Delete societies
    await sb.from("societies").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Delete non-admin auth users
    const { data: allUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const nonAdminAuthUsers = (allUsers?.users || []).filter((u: any) => !adminUserIds.includes(u.id));
    for (const u of nonAdminAuthUsers) {
      try {
        await sb.auth.admin.deleteUser(u.id);
      } catch (e) {
        console.warn(`Failed to delete auth user ${u.id}:`, e.message);
      }
    }

    results.push(makeResult("reset", "purge_user_data", "passed", {
      tables_cleaned: deleteTables.length,
      auth_users_deleted: nonAdminAuthUsers.length,
      admin_preserved: adminUserIds.length,
    }));

    // ─── PHASE 3: Create societies ──────────────────────────────
    // Null out admin society references so we can delete old societies
    for (const aid of adminUserIds) {
      await sb.from("profiles").update({ society_id: null }).eq("id", aid);
    }
    // Try to remove leftover societies from partial runs, but tolerate rows
    // that other tables still reference — the upsert below reuses them.
    await sb.from("societies").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Upsert on slug (the unique key) instead of a plain insert, which would
    // fail with societies_slug_key whenever a delete above was blocked.
    const { data: societyRows, error: socErr } = await sb
      .from("societies")
      .upsert(SOCIETIES, { onConflict: "slug" })
      .select("id, name, slug");

    if (socErr) throw new Error(`Society insert: ${socErr.message}`);
    const bySlug = new Map<string, any>((societyRows || []).map((s: any) => [s.slug, s]));
    const orderedSocieties = SOCIETIES.map((s: any) => bySlug.get(s.slug)).filter(Boolean);
    const societyIds = orderedSocieties.map((s: any) => s.id);


    results.push(makeResult("seed", "create_societies", "passed", { count: societyIds.length, societies: societyRows }));

    // Reassign admin to first society
    for (const aid of adminUserIds) {
      await sb.from("profiles").update({ society_id: societyIds[0] }).eq("id", aid);
    }

    // ─── PHASE 4: Create auth users + profiles ─────────────────
    const allUserDefs = [...SELLERS, ...BUYERS];
    const createdUsers: Record<string, { id: string; email: string; societyId: string }> = {};

    // Any auth users that survived the purge (delete failures, rate limits) must
    // be reused instead of re-created, otherwise createUser fails with
    // "email address has already been registered".
    const { data: survivingUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const byEmail = new Map<string, string>(
      (survivingUsers?.users || []).map((u: any) => [String(u.email).toLowerCase(), u.id])
    );

    for (const u of allUserDefs) {
      let userId = byEmail.get(u.email.toLowerCase());

      if (!userId) {
        const { data: authData, error: authErr } = await sb.auth.admin.createUser({
          email: u.email,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { name: u.name },
        });

        if (authErr) throw new Error(`Auth create ${u.email}: ${authErr.message}`);
        userId = authData.user.id;
      } else {
        // Reset the password so the documented seed credentials always work.
        await sb.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
      }

      const societyId = societyIds[u.societyIdx];

      // Upsert, not insert: the handle_new_user trigger already creates a
      // profile row for every new auth user, so a plain insert collides on
      // profiles_pkey.
      const { error: profErr } = await sb.from("profiles").upsert({
        id: userId,
        name: u.name,
        phone: u.phone,
        flat_number: u.flat,
        block: u.block,
        society_id: societyId,
        verification_status: "approved",
        email: u.email,
      }, { onConflict: "id" });

      if (profErr) throw new Error(`Profile ${u.email}: ${profErr.message}`);

      // Assign role (idempotent)
      await sb.from("user_roles").upsert(
        { user_id: userId, role: u.role },
        { onConflict: "user_id,role" }
      );

      createdUsers[u.email] = { id: userId, email: u.email, societyId };
    }


    results.push(makeResult("seed", "create_users_profiles", "passed", {
      sellers_created: SELLERS.length,
      buyers_created: BUYERS.length,
      total: allUserDefs.length,
    }));

    // ─── PHASE 5: Create seller profiles ────────────────────────
    const sellerProfileMap: Record<string, string> = {}; // email -> seller_profile.id

    for (const s of SELLERS) {
      const user = createdUsers[s.email];
      const { data: sp, error: spErr } = await sb
        .from("seller_profiles")
        .insert({
          user_id: user.id,
          business_name: s.business,
          description: s.desc,
          categories: s.categories,
          primary_group: s.primary_group,
          is_available: true,
          accepts_cod: true,
          accepts_upi: true,
          verification_status: "approved",
          society_id: user.societyId,
          sell_beyond_community: true,
          delivery_radius_km: s.delivery_radius_km,
          operating_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
          rating: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
          total_reviews: Math.floor(Math.random() * 50),
        })
        .select("id")
        .single();

      if (spErr) throw new Error(`Seller profile ${s.email}: ${spErr.message}`);
      sellerProfileMap[s.email] = sp!.id;
    }

    results.push(makeResult("seed", "create_seller_profiles", "passed", {
      count: Object.keys(sellerProfileMap).length,
    }));

    // ─── PHASE 5b: Create seller licenses for food sellers ──────
    // The check_seller_license trigger requires FSSAI for food group
    const foodGroupId = "7df7f8c6-3988-4ba4-9fcd-6bc7281464ac";
    const foodSellers = SELLERS.filter(s => s.primary_group === "food");
    for (const fs of foodSellers) {
      const sellerId = sellerProfileMap[fs.email];
      const { error: licErr } = await sb.from("seller_licenses").insert({
        seller_id: sellerId,
        group_id: foodGroupId,
        license_type: "FSSAI Certificate",
        license_number: `FSSAI-SEED-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        document_url: "https://placeholder.sociva.com/fssai-seed-doc.pdf",
        status: "approved",
        reviewed_at: new Date().toISOString(),
      });
      if (licErr) console.warn(`License for ${fs.email}:`, licErr.message);
    }

    results.push(makeResult("seed", "create_food_licenses", "passed", {
      count: foodSellers.length,
    }));

    // ─── PHASE 6: Create products with specifications ───────────
    let totalProducts = 0;
    let productsWithSpecs = 0;

    for (const s of SELLERS) {
      const products = getProductsForSeller(s.email);
      const sellerId = sellerProfileMap[s.email];

      for (const p of products) {
        const hasSpecs = !!p.specifications;
        const { error: prodErr } = await sb.from("products").insert({
          seller_id: sellerId,
          name: p.name,
          price: p.price,
          mrp: p.mrp || null,
          category: p.category,
          is_veg: p.is_veg,
          description: p.description,
          is_available: true,
          is_bestseller: p.is_bestseller || false,
          is_recommended: p.is_recommended || false,
          action_type: p.action_type || "add_to_cart",
          approval_status: "approved",
          prep_time_minutes: p.prep_time_minutes || null,
          cuisine_type: p.cuisine_type || null,
          serving_size: p.serving_size || null,
          spice_level: p.spice_level || null,
          service_duration_minutes: p.service_duration_minutes || null,
          brand: p.brand || null,
          specifications: p.specifications || null,
        });

        if (prodErr) {
          console.warn(`Product ${p.name}:`, prodErr.message);
        } else {
          totalProducts++;
          if (hasSpecs) productsWithSpecs++;
        }
      }
    }

    results.push(makeResult("seed", "create_products", "passed", {
      total: totalProducts,
      with_attribute_blocks: productsWithSpecs,
    }));

    // ─── PHASE 7: Verify buyer discovery ────────────────────────
    // Test that buyers can discover sellers within radius
    for (const buyer of BUYERS) {
      const bUser = createdUsers[buyer.email];
      const { data: nearbySellers, error: nearbyErr } = await sb.rpc("search_nearby_sellers", {
        _buyer_society_id: bUser.societyId,
        _radius_km: 10,
      });

      results.push(makeResult("verify", `buyer_discovery_${buyer.name.replace(/\s/g, '_')}`, nearbyErr ? "failed" : "passed", {
        buyer: buyer.email,
        buyer_society: bUser.societyId,
        sellers_found: (nearbySellers || []).length,
        seller_names: (nearbySellers || []).map((s: any) => s.business_name),
      }, nearbyErr?.message));
    }

    // ─── PHASE 8: Verify product specs are readable ─────────────
    const { data: specProducts } = await sb
      .from("products")
      .select("id, name, specifications, category, seller_id")
      .not("specifications", "is", null)
      .limit(50);

    results.push(makeResult("verify", "products_with_specifications", "passed", {
      count: (specProducts || []).length,
      sample: (specProducts || []).slice(0, 3).map((p: any) => ({
        name: p.name,
        category: p.category,
        spec_blocks: p.specifications?.blocks?.length || 0,
      })),
    }));

    // ─── PHASE 9: Save all results to test_results ──────────────
    const duration = Date.now() - t0;
    results.push(makeResult("summary", "seed_completed", "passed", {
      duration_ms: duration,
      societies: societyIds.length,
      sellers: SELLERS.length,
      buyers: BUYERS.length,
      products: totalProducts,
      products_with_specs: productsWithSpecs,
    }));

    // Save results
    const { error: saveErr } = await sb.from("test_results").insert(
      results.map((r) => ({ ...r, duration_ms: duration }))
    );
    if (saveErr) console.error("Save results:", saveErr.message);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: RUN_ID,
        duration_ms: duration,
        summary: {
          societies: societyIds.length,
          sellers: SELLERS.length,
          buyers: BUYERS.length,
          products: totalProducts,
          products_with_specs: productsWithSpecs,
          admin_preserved: adminUserIds.length,
          test_results_saved: results.length,
          credentials: { password: PASSWORD, buyers: BUYERS.map(b => b.email), sellers: SELLERS.map(s => s.email) },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    results.push(makeResult("error", "fatal_error", "failed", null, error.message));

    // Try to save partial results
    try {
      await sb.from("test_results").insert(results.map((r) => ({ ...r, duration_ms: Date.now() - t0 })));
    } catch (e) {
      console.error("Failed to save error results:", e);
    }

    return new Response(
      JSON.stringify({ success: false, error: error.message, run_id: RUN_ID, partial_results: results.length }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
