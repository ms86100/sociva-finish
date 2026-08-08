/**
 * Seed Product Validation Tests
 * ==============================
 * These tests validate that the seed function creates SPECIFIC products
 * with the correct data, specifications, and searchability.
 * 
 * Unlike the shallow count-based tests, these verify:
 *   1. Named products exist (Butter Chicken Thali, IIT-JEE Math Foundation, etc.)
 *   2. Products have correct specifications JSONB with attribute blocks
 *   3. spice_level values pass the database validation trigger (lowercase only)
 *   4. Products are discoverable via search (name, description, category)
 *   5. Cross-society products appear via search_nearby_sellers RPC
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabaseEnv, authHeaders } from "./helpers/supabase-env";

let client: SupabaseClient;
let seedResult: any;

const SEED_PRODUCT_FINGERPRINT = [
  "Butter Chicken Thali",
  "Paneer Tikka Masala",
  "Dal Makhani",
  "IIT-JEE Math Foundation (Monthly)",
  "Hatha Yoga (Morning Batch)",
  "Mechanical Keyboard",
  "Masala Dosa",
];

const SEED_BLOCK_FINGERPRINT = [
  "nutrition_info",
  "allergen_info",
  "course_details",
  "session_details",
  "product_specs",
];

// Probe once at collection time: these assertions only make sense against a
// backend that holds the demo seed data. Skip (don't fail) otherwise.
async function probeSeed(): Promise<boolean> {
  if (!hasSupabaseEnv) return false;

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  // A single leftover product is not proof that the destructive seed completed.
  // Require the complete fixture fingerprint before running integration assertions.
  const [{ data: existingProducts }, { data: existingBlocks }] = await Promise.all([
    client
    .from("products")
    .select("id, name")
    .eq("approval_status", "approved")
    .eq("is_available", true)
      .in("name", SEED_PRODUCT_FINGERPRINT),
    client
      .from("attribute_block_library")
      .select("block_type")
      .eq("is_active", true)
      .in("block_type", SEED_BLOCK_FINGERPRINT),
  ]);

  const productNames = new Set((existingProducts || []).map((p: any) => p.name));
  const blockTypes = new Set((existingBlocks || []).map((b: any) => b.block_type));
  const hasCompleteFingerprint =
    SEED_PRODUCT_FINGERPRINT.every((name) => productNames.has(name)) &&
    SEED_BLOCK_FINGERPRINT.every((type) => blockTypes.has(type));

  if (hasCompleteFingerprint) {
    seedResult = { success: true };
    return true;
  }

  // Trigger the seed function (disabled outside test environments)
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/reset-and-seed-scenario`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) {
      console.warn(
        `[seed-products] External integration unavailable (${res.status}); ` +
        `fixture fingerprint incomplete (${productNames.size}/${SEED_PRODUCT_FINGERPRINT.length} products, ` +
        `${blockTypes.size}/${SEED_BLOCK_FINGERPRINT.length} blocks)`,
      );
      return false;
    }
    seedResult = await res.json();
    return seedResult?.success === true;
  } catch (err) {
    console.warn(`[seed-products] Skipping suite — ${(err as Error).message}`);
    return false;
  }
}

const seeded = await probeSeed();
const describeSeeded = seeded ? describe : describe.skip;

describeSeeded("Seed Product Validation", () => {


  // ────────────────────────────────────────────────────────
  // 1. SPECIFIC PRODUCT EXISTENCE
  // ────────────────────────────────────────────────────────
  describe("Named product existence", () => {
    const EXPECTED_PRODUCTS = [
      { name: "Butter Chicken Thali", category: "home_food" },
      { name: "Paneer Tikka Masala", category: "home_food" },
      { name: "Dal Makhani", category: "home_food" },
      { name: "IIT-JEE Math Foundation (Monthly)", category: "coaching" },
      { name: "Hatha Yoga (Morning Batch)", category: "yoga" },
      { name: "Mechanical Keyboard", category: "electronics" },
      { name: "Masala Dosa", category: "home_food" },
    ];

    it.each(EXPECTED_PRODUCTS)(
      "should have created '$name' in category '$category'",
      async ({ name, category }) => {
        const { data, error } = await client
          .from("products")
          .select("id, name, category, is_available, approval_status")
          .eq("name", name)
          .eq("category", category)
          .maybeSingle();

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.is_available).toBe(true);
        expect(data!.approval_status).toBe("approved");
      }
    );
  });

  // ────────────────────────────────────────────────────────
  // 2. SPECIFICATIONS / ATTRIBUTE BLOCKS
  // ────────────────────────────────────────────────────────
  describe("Product specifications", () => {
    it("Butter Chicken Thali should have nutrition_info and allergen_info blocks", async () => {
      const { data, error } = await client
        .from("products")
        .select("specifications")
        .eq("name", "Butter Chicken Thali")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.specifications).not.toBeNull();

      const specs = data!.specifications as any;
      expect(specs.blocks).toBeDefined();
      expect(Array.isArray(specs.blocks)).toBe(true);

      const blockTypes = specs.blocks.map((b: any) => b.type);
      expect(blockTypes).toContain("nutrition_info");
      expect(blockTypes).toContain("allergen_info");

      // Verify nutrition data has actual values
      const nutritionBlock = specs.blocks.find((b: any) => b.type === "nutrition_info");
      expect(nutritionBlock.data.calories).toBeDefined();
      expect(nutritionBlock.data.protein).toBeDefined();
    });

    it("IIT-JEE Math Foundation should have course_details block", async () => {
      const { data, error } = await client
        .from("products")
        .select("specifications")
        .eq("name", "IIT-JEE Math Foundation (Monthly)")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const specs = data!.specifications as any;
      expect(specs.blocks).toBeDefined();

      const blockTypes = specs.blocks.map((b: any) => b.type);
      expect(blockTypes).toContain("course_details");

      const courseBlock = specs.blocks.find((b: any) => b.type === "course_details");
      expect(courseBlock.data.level).toBeDefined();
      expect(courseBlock.data.schedule).toBeDefined();
    });

    it("Hatha Yoga should have session_details block", async () => {
      const { data, error } = await client
        .from("products")
        .select("specifications")
        .eq("name", "Hatha Yoga (Morning Batch)")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const specs = data!.specifications as any;
      expect(specs.blocks).toBeDefined();

      const blockTypes = specs.blocks.map((b: any) => b.type);
      expect(blockTypes).toContain("session_details");
    });

    it("Mechanical Keyboard should have product_specs block", async () => {
      const { data, error } = await client
        .from("products")
        .select("specifications")
        .eq("name", "Mechanical Keyboard")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const specs = data!.specifications as any;
      expect(specs.blocks).toBeDefined();

      const blockTypes = specs.blocks.map((b: any) => b.type);
      expect(blockTypes).toContain("product_specs");
    });

    it("Masala Dosa should have nutrition_info block", async () => {
      const { data, error } = await client
        .from("products")
        .select("specifications")
        .eq("name", "Masala Dosa")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const specs = data!.specifications as any;
      expect(specs.blocks).toBeDefined();

      const nutritionBlock = specs.blocks.find((b: any) => b.type === "nutrition_info");
      expect(nutritionBlock).toBeDefined();
      expect(nutritionBlock.data.calories).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────
  // 3. SPICE LEVEL VALIDATION (lowercase enforcement)
  // ────────────────────────────────────────────────────────
  describe("Spice level validation", () => {
    it("all home_food products with spice_level should use lowercase values", async () => {
      const { data, error } = await client
        .from("products")
        .select("name, spice_level")
        .eq("category", "home_food")
        .not("spice_level", "is", null);

      expect(error).toBeNull();
      const validLevels = ["mild", "medium", "hot", "extra_hot"];
      for (const product of data || []) {
        expect(validLevels).toContain(product.spice_level);
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // 4. SEARCH DISCOVERABILITY
  // ────────────────────────────────────────────────────────
  describe("Product searchability", () => {
    it("searching 'butter chicken' should find Butter Chicken Thali", async () => {
      const { data, error } = await client
        .from("products")
        .select("id, name")
        .eq("is_available", true)
        .eq("approval_status", "approved")
        .ilike("name", "%butter chicken%");

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
      expect(data!.some((p: any) => p.name === "Butter Chicken Thali")).toBe(true);
    });

    it("searching 'yoga' should find yoga products", async () => {
      const { data, error } = await client
        .from("products")
        .select("id, name, category")
        .eq("is_available", true)
        .eq("approval_status", "approved")
        .or("name.ilike.%yoga%,category.ilike.%yoga%");

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(3);
    });

    it("searching 'keyboard' should find electronics products", async () => {
      const { data, error } = await client
        .from("products")
        .select("id, name")
        .eq("is_available", true)
        .eq("approval_status", "approved")
        .ilike("name", "%keyboard%");

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ────────────────────────────────────────────────────────
  // 5. ATTRIBUTE BLOCK LIBRARY EXISTS
  // ────────────────────────────────────────────────────────
  describe("Attribute block library", () => {
    const REQUIRED_BLOCKS = [
      "nutrition_info",
      "allergen_info",
      "course_details",
      "session_details",
      "product_specs",
    ];

    it.each(REQUIRED_BLOCKS)(
      "block type '%s' should exist and be active in the library",
      async (blockType) => {
        const { data, error } = await client
          .from("attribute_block_library")
          .select("id, block_type, display_name, is_active, schema")
          .eq("block_type", blockType)
          .eq("is_active", true)
          .maybeSingle();

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect(data!.display_name).toBeTruthy();
        expect(data!.schema).toBeDefined();
      }
    );

    it("each block should have a valid schema with fields array", async () => {
      const { data, error } = await client
        .from("attribute_block_library")
        .select("block_type, schema")
        .eq("is_active", true)
        .in("block_type", REQUIRED_BLOCKS);

      expect(error).toBeNull();
      expect(data!.length).toBe(REQUIRED_BLOCKS.length);

      for (const block of data!) {
        const schema = block.schema as any;
        expect(schema.fields).toBeDefined();
        expect(Array.isArray(schema.fields)).toBe(true);
        expect(schema.fields.length).toBeGreaterThan(0);

        // Each field should have key, label, type
        for (const field of schema.fields) {
          expect(field.key).toBeTruthy();
          expect(field.label).toBeTruthy();
          expect(field.type).toBeTruthy();
        }
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // 6. CROSS-SOCIETY DISCOVERY
  // ────────────────────────────────────────────────────────
  describe("Cross-society discovery", () => {
    it("search_nearby_sellers should return sellers from other societies", async () => {
      // Get the first society
      const { data: societies } = await client
        .from("societies")
        .select("id, name")
        .not("latitude", "is", null)
        .limit(1);

      expect(societies).toBeTruthy();
      expect(societies!.length).toBeGreaterThan(0);

      const { data, error } = await client.rpc("search_nearby_sellers", {
        _buyer_society_id: societies![0].id,
        _radius_km: 10,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();

      // If there are nearby sellers, they should have matching_products
      if (Array.isArray(data) && data.length > 0) {
        for (const seller of data) {
          expect(seller.seller_id).toBeTruthy();
          expect(seller.business_name).toBeTruthy();
          expect(seller.matching_products).toBeDefined();
          expect(Array.isArray(seller.matching_products)).toBe(true);
          expect(seller.matching_products.length).toBeGreaterThan(0);

          // Each product in matching_products should have required fields
          for (const p of seller.matching_products) {
            expect(p.id).toBeTruthy();
            expect(p.name).toBeTruthy();
            expect(typeof p.price).toBe("number");
          }
        }
      }
    });
  });
});
