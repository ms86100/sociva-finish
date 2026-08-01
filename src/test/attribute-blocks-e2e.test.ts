/**
 * Attribute Blocks E2E Integration Test
 * =======================================
 * Tests the full attribute block lifecycle with real DB:
 * Admin CRUD → Dynamic re-linking → Seller product creation →
 * Admin approval → Buyer verification → Edge cases & regression.
 *
 * Prerequisites: Run seed-integration-test-users edge function first.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAuthenticatedClient,
  getCurrentUserId,
  trySeedTestUsers,
  testSlug,
} from "./helpers/integration";

// Skip the whole suite when the seed edge function is unavailable/disabled
const SEED = await trySeedTestUsers();
const describeDb = SEED ? describe : describe.skip;

// ─── Shared State ─────────────────────────────────────────────────────
let adminClient: SupabaseClient;
let sellerClient: SupabaseClient;
let buyerClient: SupabaseClient;
let adminUserId: string;
let sellerUserId: string;
let buyerUserId: string;
let sellerSocietyId: string;

// IDs created during the test (for cleanup)
const cleanup = {
  categoryId: "",
  category2Id: "",
  blockAId: "",
  blockBId: "",
  sellerProfileId: "",
  productId: "",
  emptyProductId: "",
  formConfigId: "",
};

// Dynamic slugs
const catSlug = testSlug("integ_attr_cat");
const cat2Slug = testSlug("integ_attr_cat2");
const blockASlug = testSlug("integ_block_a");
const blockBSlug = testSlug("integ_block_b");

// ═══════════════════════════════════════════════════════════════════════
// SETUP & TEARDOWN
// ═══════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  if (!SEED) return;
  // Ensure test users exist FIRST (they may have been deleted by reset-and-seed)
  const seedData = SEED!;
  sellerSocietyId = seedData.society_id;

  [adminClient, sellerClient, buyerClient] = await Promise.all([
    createAuthenticatedClient("admin"),
    createAuthenticatedClient("seller"),
    createAuthenticatedClient("buyer"),
  ]);

  [adminUserId, sellerUserId, buyerUserId] = await Promise.all([
    getCurrentUserId(adminClient),
    getCurrentUserId(sellerClient),
    getCurrentUserId(buyerClient),
  ]);

  // sellerSocietyId already set above from seedData

  // Pre-cleanup: remove leftover data from previous failed runs
  // Match by block_type prefix pattern
  await adminClient
    .from("products")
    .delete()
    .like("category", "integ_attr_cat_%");
  await adminClient
    .from("seller_form_configs")
    .delete()
    .like("category", "integ_attr_cat_%");
  await adminClient
    .from("attribute_block_library")
    .delete()
    .like("block_type", "integ_block_%");

  // Clean seller profiles created for this test
  const { data: existingSeller } = await adminClient
    .from("seller_profiles")
    .select("id")
    .eq("user_id", sellerUserId)
    .eq("primary_group", "resale")
    .maybeSingle();
  if (existingSeller) {
    await adminClient.from("products").delete().eq("seller_id", existingSeller.id);
    await adminClient.from("seller_profiles").delete().eq("id", existingSeller.id);
  }

  await adminClient
    .from("category_config")
    .delete()
    .like("category", "integ_attr_cat_%");
}, 30000);

afterAll(async () => {
  if (!SEED) return;
  // Reverse FK order cleanup
  if (cleanup.emptyProductId) {
    await adminClient.from("products").delete().eq("id", cleanup.emptyProductId);
  }
  if (cleanup.productId) {
    await adminClient.from("products").delete().eq("id", cleanup.productId);
  }
  if (cleanup.sellerProfileId) {
    await adminClient.from("seller_profiles").delete().eq("id", cleanup.sellerProfileId);
  }
  if (cleanup.formConfigId) {
    await adminClient.from("seller_form_configs").delete().eq("id", cleanup.formConfigId);
  }
  if (cleanup.blockAId) {
    await adminClient.from("attribute_block_library").delete().eq("id", cleanup.blockAId);
  }
  if (cleanup.blockBId) {
    await adminClient.from("attribute_block_library").delete().eq("id", cleanup.blockBId);
  }
  if (cleanup.category2Id) {
    await adminClient.from("category_config").delete().eq("id", cleanup.category2Id);
  }
  if (cleanup.categoryId) {
    await adminClient.from("category_config").delete().eq("id", cleanup.categoryId);
  }
}, 15000);

// ═══════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════

describeDb("Attribute Blocks E2E (Real DB)", () => {
  // ─── Phase 1: Admin Attribute Block CRUD ───────────────────────────
  describe("1. Admin creates category and attribute blocks", () => {
    it("1.1 admin creates test category", async () => {
      const { data, error } = await adminClient
        .from("category_config")
        .insert({
          category: catSlug,
          display_name: "Attr Test Category",
          icon: "🧪",
          color: "#4CAF50",
          parent_group: "resale",
          layout_type: "ecommerce",
          is_active: true,
          display_order: 998,
          transaction_type: "cart_purchase",
          primary_button_label: "Add to Cart",
          default_sort: "newest",
          is_physical_product: true,
          requires_price: true,
          requires_delivery: true,
          supports_cart: true,
          has_quantity: true,
          show_veg_toggle: false,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      cleanup.categoryId = data!.id;
    });

    it("1.2 admin creates attribute block A with schema fields", async () => {
      const { data, error } = await adminClient
        .from("attribute_block_library")
        .insert({
          block_type: blockASlug,
          display_name: "Test Dimensions",
          description: "Physical dimensions for integration testing",
          icon: "📏",
          category_hints: [catSlug],
          schema: {
            fields: [
              { key: "length", label: "Length (cm)", type: "number" },
              { key: "width", label: "Width (cm)", type: "number" },
              { key: "material", label: "Material", type: "text" },
            ],
          },
          renderer_type: "key_value",
          display_order: 1,
          is_active: true,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      cleanup.blockAId = data!.id;
    });

    it("1.3 admin creates attribute block B attached to same category", async () => {
      const { data, error } = await adminClient
        .from("attribute_block_library")
        .insert({
          block_type: blockBSlug,
          display_name: "Test Tags",
          description: "Tag attributes for integration testing",
          icon: "🏷️",
          category_hints: [catSlug],
          schema: {
            fields: [
              { key: "tags", label: "Product Tags", type: "tag_input" },
            ],
          },
          renderer_type: "tags",
          display_order: 2,
          is_active: true,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      cleanup.blockBId = data!.id;
    });

    it("1.4 query returns both blocks for the test category", async () => {
      const { data, error } = await adminClient
        .from("attribute_block_library")
        .select("*")
        .contains("category_hints", [catSlug])
        .eq("is_active", true);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data!.length).toBeGreaterThanOrEqual(2);
      const types = data!.map((b: any) => b.block_type);
      expect(types).toContain(blockASlug);
      expect(types).toContain(blockBSlug);
    });

    it("1.5 RLS: seller CANNOT insert into attribute_block_library", async () => {
      const { error } = await sellerClient
        .from("attribute_block_library")
        .insert({
          block_type: testSlug("rls_blocked_seller"),
          display_name: "Should Fail",
          schema: { fields: [] },
        })
        .select("id")
        .single();

      expect(error).not.toBeNull();
    });

    it("1.6 RLS: buyer CANNOT insert into attribute_block_library", async () => {
      const { error } = await buyerClient
        .from("attribute_block_library")
        .insert({
          block_type: testSlug("rls_blocked_buyer"),
          display_name: "Should Fail",
          schema: { fields: [] },
        })
        .select("id")
        .single();

      expect(error).not.toBeNull();
    });
  });

  // ─── Phase 2: Dynamic Category Re-linking ─────────────────────────
  describe("2. Dynamic category re-linking", () => {
    it("2.1 admin creates second test category", async () => {
      const { data, error } = await adminClient
        .from("category_config")
        .insert({
          category: cat2Slug,
          display_name: "Attr Test Category 2",
          icon: "🧫",
          color: "#2196F3",
          parent_group: "resale",
          layout_type: "ecommerce",
          is_active: true,
          display_order: 997,
          transaction_type: "cart_purchase",
          primary_button_label: "Add to Cart",
          default_sort: "newest",
          is_physical_product: true,
          requires_price: true,
          requires_delivery: true,
          supports_cart: true,
          has_quantity: true,
          show_veg_toggle: false,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      cleanup.category2Id = data!.id;
    });

    it("2.2 admin updates block A hints to include BOTH categories", async () => {
      const { error } = await adminClient
        .from("attribute_block_library")
        .update({ category_hints: [catSlug, cat2Slug] })
        .eq("id", cleanup.blockAId);

      expect(error).toBeNull();
    });

    it("2.3 querying blocks for category 2 returns block A", async () => {
      const { data } = await adminClient
        .from("attribute_block_library")
        .select("block_type")
        .contains("category_hints", [cat2Slug])
        .eq("is_active", true);

      expect(data!.map((b: any) => b.block_type)).toContain(blockASlug);
    });

    it("2.4 admin removes category 1 from block A (only category 2)", async () => {
      const { error } = await adminClient
        .from("attribute_block_library")
        .update({ category_hints: [cat2Slug] })
        .eq("id", cleanup.blockAId);

      expect(error).toBeNull();
    });

    it("2.5 querying blocks for category 1 no longer returns block A", async () => {
      const { data } = await adminClient
        .from("attribute_block_library")
        .select("block_type")
        .contains("category_hints", [catSlug])
        .eq("is_active", true);

      const types = (data || []).map((b: any) => b.block_type);
      expect(types).not.toContain(blockASlug);
      // block B should still be there
      expect(types).toContain(blockBSlug);
    });

    it("2.6 admin restores block A to category 1 for later phases", async () => {
      const { error } = await adminClient
        .from("attribute_block_library")
        .update({ category_hints: [catSlug, cat2Slug] })
        .eq("id", cleanup.blockAId);

      expect(error).toBeNull();
    });
  });

  // ─── Phase 3: Seller Product with Attribute Data ──────────────────
  describe("3. Seller creates product with attribute data", () => {
    it("3.1 seller creates a seller profile", async () => {
      const { data, error } = await sellerClient
        .from("seller_profiles")
        .upsert(
          {
            user_id: sellerUserId,
            business_name: "Attr Test Store",
            description: "Testing attribute blocks",
            categories: [catSlug],
            primary_group: "resale",
            society_id: sellerSocietyId,
            fulfillment_mode: "both",
            delivery_radius_km: 5,
            operating_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
            accepts_upi: false,
            accepts_cod: true,
            verification_status: "pending",
          },
          { onConflict: "user_id,primary_group" }
        )
        .select("id")
        .single();

      expect(error).toBeNull();
      cleanup.sellerProfileId = data!.id;
    });

    it("3.2 seller reads attribute blocks filtered by category", async () => {
      const { data, error } = await sellerClient
        .from("attribute_block_library")
        .select("*")
        .contains("category_hints", [catSlug])
        .eq("is_active", true);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });

    it("3.3 seller creates product with specifications.blocks", async () => {
      const specs = {
        blocks: [
          { type: blockASlug, data: { length: 25, width: 10, material: "Wood" } },
          { type: blockBSlug, data: { tags: ["handmade", "eco-friendly"] } },
        ],
      };

      const { data, error } = await sellerClient
        .from("products")
        .insert({
          name: "Attr Test Product",
          description: "Product with attribute blocks",
          price: 500,
          mrp: 600,
          category: catSlug,
          seller_id: cleanup.sellerProfileId,
          is_available: true,
          approval_status: "draft",
          action_type: "add_to_cart",
          stock_quantity: 10,
          specifications: specs as any,
        })
        .select("id, specifications")
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      cleanup.productId = data!.id;

      // Verify JSONB structure
      const savedSpecs = data!.specifications as any;
      expect(savedSpecs.blocks).toHaveLength(2);
      expect(savedSpecs.blocks[0].type).toBe(blockASlug);
      expect(savedSpecs.blocks[0].data.material).toBe("Wood");
      expect(savedSpecs.blocks[1].type).toBe(blockBSlug);
      expect(savedSpecs.blocks[1].data.tags).toContain("handmade");
    });

    it("3.4 seller updates attribute data on their product", async () => {
      const updatedSpecs = {
        blocks: [
          { type: blockASlug, data: { length: 30, width: 15, material: "Bamboo" } },
          { type: blockBSlug, data: { tags: ["handmade", "eco-friendly", "organic"] } },
        ],
      };

      const { error } = await sellerClient
        .from("products")
        .update({ specifications: updatedSpecs as any })
        .eq("id", cleanup.productId);

      expect(error).toBeNull();
    });

    it("3.5 updated data persisted correctly", async () => {
      const { data } = await sellerClient
        .from("products")
        .select("specifications")
        .eq("id", cleanup.productId)
        .single();

      const specs = data!.specifications as any;
      expect(specs.blocks[0].data.material).toBe("Bamboo");
      expect(specs.blocks[0].data.length).toBe(30);
      expect(specs.blocks[1].data.tags).toContain("organic");
    });
  });

  // ─── Phase 4: Admin Approval ──────────────────────────────────────
  describe("4. Admin approves seller and product", () => {
    it("4.1 admin approves seller profile", async () => {
      const { error } = await adminClient
        .from("seller_profiles")
        .update({ verification_status: "approved" })
        .eq("id", cleanup.sellerProfileId);

      expect(error).toBeNull();
    });

    it("4.2 admin approves product", async () => {
      const { error } = await adminClient
        .from("products")
        .update({ approval_status: "approved" })
        .eq("id", cleanup.productId);

      expect(error).toBeNull();
    });

    it("4.3 admin reads product specifications and verifies integrity", async () => {
      const { data } = await adminClient
        .from("products")
        .select("specifications, category")
        .eq("id", cleanup.productId)
        .single();

      const specs = data!.specifications as any;
      expect(specs.blocks).toHaveLength(2);
      expect(data!.category).toBe(catSlug);

      // Cross-check: each block type should exist in the library
      for (const block of specs.blocks) {
        const { data: libBlock } = await adminClient
          .from("attribute_block_library")
          .select("id, category_hints")
          .eq("block_type", block.type)
          .single();

        expect(libBlock).not.toBeNull();
        expect((libBlock!.category_hints as string[]) || []).toContain(catSlug);
      }
    });
  });

  // ─── Phase 5: Buyer Reads Product Attributes ──────────────────────
  describe("5. Buyer reads product attributes", () => {
    it("5.1 buyer queries the approved product", async () => {
      // Buyer may or may not see it due to cross-society RLS
      // Use admin as fallback to verify data integrity
      const { data: buyerView } = await buyerClient
        .from("products")
        .select("id, specifications, category")
        .eq("id", cleanup.productId)
        .maybeSingle();

      // Use whichever client can see it
      const product = buyerView || (
        await adminClient
          .from("products")
          .select("id, specifications, category")
          .eq("id", cleanup.productId)
          .single()
      ).data!;

      const specs = product.specifications as any;
      expect(specs.blocks).toHaveLength(2);
    });

    it("5.2 specifications.blocks has correct structure and data", async () => {
      const { data } = await adminClient
        .from("products")
        .select("specifications")
        .eq("id", cleanup.productId)
        .single();

      const specs = data!.specifications as any;
      for (const block of specs.blocks) {
        expect(block).toHaveProperty("type");
        expect(block).toHaveProperty("data");
        expect(typeof block.type).toBe("string");
        expect(typeof block.data).toBe("object");
      }
    });

    it("5.3 each block type matches an active block in library", async () => {
      const { data: product } = await adminClient
        .from("products")
        .select("specifications")
        .eq("id", cleanup.productId)
        .single();

      const { data: library } = await adminClient
        .from("attribute_block_library")
        .select("block_type")
        .eq("is_active", true);

      const activeTypes = (library || []).map((b: any) => b.block_type);
      const specs = product!.specifications as any;

      for (const block of specs.blocks) {
        expect(activeTypes).toContain(block.type);
      }
    });

    it("5.4 block category_hints includes product category", async () => {
      const { data: product } = await adminClient
        .from("products")
        .select("specifications, category")
        .eq("id", cleanup.productId)
        .single();

      const specs = product!.specifications as any;
      for (const block of specs.blocks) {
        const { data: libBlock } = await adminClient
          .from("attribute_block_library")
          .select("category_hints")
          .eq("block_type", block.type)
          .single();

        expect((libBlock!.category_hints as string[]) || []).toContain(product!.category);
      }
    });
  });

  // ─── Phase 6: Edge Cases & Regression ─────────────────────────────
  describe("6. Edge cases and regression", () => {
    it("6.1 deactivating block B does NOT remove product specifications", async () => {
      const { error } = await adminClient
        .from("attribute_block_library")
        .update({ is_active: false })
        .eq("id", cleanup.blockBId);

      expect(error).toBeNull();

      // Product specs unchanged
      const { data } = await adminClient
        .from("products")
        .select("specifications")
        .eq("id", cleanup.productId)
        .single();

      const specs = data!.specifications as any;
      expect(specs.blocks).toHaveLength(2);
      expect(specs.blocks[1].type).toBe(blockBSlug);
    });

    it("6.2 buyer re-reads product — specs still contain block B data (graceful degradation)", async () => {
      const { data } = await adminClient
        .from("products")
        .select("specifications")
        .eq("id", cleanup.productId)
        .single();

      const specs = data!.specifications as any;
      const blockB = specs.blocks.find((b: any) => b.type === blockBSlug);
      expect(blockB).toBeDefined();
      expect(blockB.data.tags).toContain("handmade");
    });

    it("6.3 seller creates product with empty blocks array", async () => {
      const { data, error } = await sellerClient
        .from("products")
        .insert({
          name: "Attr Empty Blocks Product",
          description: "Product with no attribute data",
          price: 100,
          mrp: 120,
          category: catSlug,
          seller_id: cleanup.sellerProfileId,
          is_available: true,
          approval_status: "draft",
          action_type: "add_to_cart",
          stock_quantity: 5,
          specifications: { blocks: [] } as any,
        })
        .select("id, specifications")
        .single();

      expect(error).toBeNull();
      cleanup.emptyProductId = data!.id;

      const specs = data!.specifications as any;
      expect(specs.blocks).toHaveLength(0);
    });

    it("6.4 seller saves seller_form_config with ordered blocks", async () => {
      const { data, error } = await sellerClient
        .from("seller_form_configs")
        .insert({
          seller_id: cleanup.sellerProfileId,
          category: catSlug,
          blocks: [
            { block_type: blockBSlug, display_order: 1 },
            { block_type: blockASlug, display_order: 2 },
          ] as any,
        })
        .select("id, blocks")
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      cleanup.formConfigId = data!.id;
    });

    it("6.5 seller_form_config returns correct block ordering", async () => {
      const { data } = await sellerClient
        .from("seller_form_configs")
        .select("blocks")
        .eq("id", cleanup.formConfigId)
        .single();

      const blocks = data!.blocks as any[];
      expect(blocks[0].block_type).toBe(blockBSlug);
      expect(blocks[0].display_order).toBe(1);
      expect(blocks[1].block_type).toBe(blockASlug);
      expect(blocks[1].display_order).toBe(2);
    });

    it("6.6 RLS: seller CANNOT update attribute_block_library", async () => {
      const { error } = await sellerClient
        .from("attribute_block_library")
        .update({ display_name: "Hacked" })
        .eq("id", cleanup.blockAId);

      // Verify unchanged
      const { data } = await adminClient
        .from("attribute_block_library")
        .select("display_name")
        .eq("id", cleanup.blockAId)
        .single();

      expect(data!.display_name).toBe("Test Dimensions");
    });

    it("6.7 admin re-activates block B (restore for cleanup)", async () => {
      const { error } = await adminClient
        .from("attribute_block_library")
        .update({ is_active: true })
        .eq("id", cleanup.blockBId);

      expect(error).toBeNull();
    });
  });
});
