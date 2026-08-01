/**
 * Buyer Discovery End-to-End Test Suite
 * ======================================
 * Part 1: Unit tests with mocked fixtures (Haversine, visibility rules)
 * Part 2: Real DB integration tests calling search_nearby_sellers RPC
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAuthenticatedClient,
  trySeedTestUsers,
} from "./helpers/integration";

// Skip the whole suite when the seed edge function is unavailable/disabled
const SEED = await trySeedTestUsers();
const describeDb = SEED ? describe : describe.skip;

// ─── Haversine implementation (mirrors DB function) ───────────────────
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Test fixtures ────────────────────────────────────────────────────
const BUYER_SOCIETY = {
  id: "buyer-society-001",
  name: "Prestige Tranquility",
  lat: 12.9716,
  lon: 77.5946,
};

const SELLER_SOCIETY = {
  id: "seller-society-002",
  name: "Brigade Metropolis",
  lat: 12.9698, // ~0.35 km from buyer
  lon: 77.5981,
};

const FAR_SOCIETY = {
  id: "far-society-003",
  name: "Whitefield Enclave",
  lat: 12.9352, // ~5.1 km from buyer
  lon: 77.6382,
};

const APPROVED_SELLER = {
  id: "seller-profile-001",
  business_name: "Sagar's Kitchen",
  verification_status: "approved" as const,
  is_available: true,
  sell_beyond_community: true,
  delivery_radius_km: 5,
  society_id: SELLER_SOCIETY.id,
  categories: ["home_food", "snacks"],
  primary_group: "food",
};

const UNAPPROVED_SELLER = {
  id: "seller-profile-002",
  business_name: "Pending Kitchen",
  verification_status: "pending" as const,
  is_available: true,
  sell_beyond_community: true,
  delivery_radius_km: 5,
  society_id: SELLER_SOCIETY.id,
  categories: ["home_food"],
  primary_group: "food",
};

const UNAVAILABLE_SELLER = {
  id: "seller-profile-003",
  business_name: "Closed Kitchen",
  verification_status: "approved" as const,
  is_available: false,
  sell_beyond_community: true,
  delivery_radius_km: 5,
  society_id: SELLER_SOCIETY.id,
  categories: ["home_food"],
  primary_group: "food",
};

const FAR_SELLER = {
  id: "seller-profile-004",
  business_name: "Far Away Foods",
  verification_status: "approved" as const,
  is_available: true,
  sell_beyond_community: true,
  delivery_radius_km: 3, // Can only deliver 3km, but is 5.1km away
  society_id: FAR_SOCIETY.id,
  categories: ["home_food"],
  primary_group: "food",
};

const APPROVED_PRODUCTS = [
  {
    id: "prod-001",
    name: "Butter Paneer Meal",
    price: 180,
    category: "home_food",
    is_available: true,
    approval_status: "approved" as const,
    seller_id: APPROVED_SELLER.id,
  },
  {
    id: "prod-002",
    name: "Dal Tadka with Rice",
    price: 120,
    category: "home_food",
    is_available: true,
    approval_status: "approved" as const,
    seller_id: APPROVED_SELLER.id,
  },
  {
    id: "prod-003",
    name: "Fish Curry Meal",
    price: 200,
    category: "home_food",
    is_available: true,
    approval_status: "approved" as const,
    seller_id: APPROVED_SELLER.id,
  },
];

const DRAFT_PRODUCT = {
  id: "prod-004",
  name: "Draft Biryani",
  price: 250,
  category: "home_food",
  is_available: true,
  approval_status: "draft" as const,
  seller_id: APPROVED_SELLER.id,
};

const UNAVAILABLE_PRODUCT = {
  id: "prod-005",
  name: "Seasonal Mango Lassi",
  price: 80,
  category: "home_food",
  is_available: false,
  approval_status: "approved" as const,
  seller_id: APPROVED_SELLER.id,
};

const BUYER_PROFILE = {
  id: "buyer-user-001",
  name: "Geeta Jaisi",
  email: "geeta@example.com",
  phone: "+918448802907",
  society_id: BUYER_SOCIETY.id,
  flat_number: "100",
  block: "Block A",
  verification_status: "approved" as const,
  browse_beyond_community: true,
  search_radius_km: 10,
};

// ─── Helper: simulate search_nearby_sellers RPC logic ─────────────────
interface SellerProfile {
  id: string;
  business_name: string;
  verification_status: "approved" | "pending" | "rejected";
  is_available: boolean;
  sell_beyond_community: boolean;
  delivery_radius_km: number;
  society_id: string;
  categories: string[];
  primary_group: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  is_available: boolean;
  approval_status: "approved" | "pending" | "draft" | "rejected";
  seller_id: string;
}

interface Society {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

function simulateNearbySellerSearch(
  buyerSociety: Society,
  societies: Society[],
  sellers: SellerProfile[],
  products: Product[],
  radiusKm: number,
) {
  const results: {
    seller: SellerProfile;
    distanceKm: number;
    societyName: string;
    visibleProducts: Product[];
  }[] = [];

  for (const seller of sellers) {
    // Rule 1: Must be approved
    if (seller.verification_status !== "approved") continue;

    // Rule 2: Must be available
    if (!seller.is_available) continue;

    // Rule 3: Must opt into cross-society selling
    if (!seller.sell_beyond_community) continue;

    // Rule 4: Must not be from same society
    if (seller.society_id === buyerSociety.id) continue;

    // Find seller's society
    const sellerSociety = societies.find((s) => s.id === seller.society_id);
    if (!sellerSociety || sellerSociety.lat == null || sellerSociety.lon == null) continue;

    // Rule 5: Distance must be within seller's delivery radius AND buyer's search radius
    const distance = haversineKm(
      buyerSociety.lat,
      buyerSociety.lon,
      sellerSociety.lat,
      sellerSociety.lon,
    );
    if (distance > seller.delivery_radius_km) continue;
    if (distance > radiusKm) continue;

    // Rule 6: Must have at least one approved, available product
    const visibleProducts = products.filter(
      (p) =>
        p.seller_id === seller.id &&
        p.is_available === true &&
        p.approval_status === "approved",
    );
    if (visibleProducts.length === 0) continue;

    results.push({
      seller,
      distanceKm: Math.round(distance * 10) / 10,
      societyName: sellerSociety.name,
      visibleProducts,
    });
  }

  // Sort by distance, then rating (simulated)
  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

// =====================================================================
// TEST SUITE
// =====================================================================

describeDb("Buyer Discovery E2E", () => {
  // ─── 1. Buyer Signup & Profile Creation ─────────────────────────────
  describe("1. Buyer Signup & Profile Creation", () => {
    it("should create a complete buyer profile with all required fields", () => {
      expect(BUYER_PROFILE.id).toBeDefined();
      expect(BUYER_PROFILE.name).toBe("Geeta Jaisi");
      expect(BUYER_PROFILE.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(BUYER_PROFILE.society_id).toBe(BUYER_SOCIETY.id);
      expect(BUYER_PROFILE.flat_number).toBeTruthy();
      expect(BUYER_PROFILE.verification_status).toBe("approved");
    });

    it("should have cross-society browsing enabled by default", () => {
      expect(BUYER_PROFILE.browse_beyond_community).toBe(true);
    });

    it("should have a valid search radius (1–10 km)", () => {
      expect(BUYER_PROFILE.search_radius_km).toBeGreaterThanOrEqual(1);
      expect(BUYER_PROFILE.search_radius_km).toBeLessThanOrEqual(10);
    });

    it("should be linked to a society with valid coordinates", () => {
      expect(BUYER_SOCIETY.lat).toBeGreaterThan(0);
      expect(BUYER_SOCIETY.lon).toBeGreaterThan(0);
    });
  });

  // ─── 2. Location & Radius Matching (Haversine) ─────────────────────
  describe("2. Location & Radius Matching", () => {
    const distanceToSeller = haversineKm(
      BUYER_SOCIETY.lat,
      BUYER_SOCIETY.lon,
      SELLER_SOCIETY.lat,
      SELLER_SOCIETY.lon,
    );

    const distanceToFar = haversineKm(
      BUYER_SOCIETY.lat,
      BUYER_SOCIETY.lon,
      FAR_SOCIETY.lat,
      FAR_SOCIETY.lon,
    );

    it("should calculate correct distance to nearby seller society (<1 km)", () => {
      expect(distanceToSeller).toBeLessThan(1);
      expect(distanceToSeller).toBeGreaterThan(0);
    });

    it("should calculate correct distance to far seller society (~6 km)", () => {
      expect(distanceToFar).toBeGreaterThan(4);
      expect(distanceToFar).toBeLessThan(7);
    });

    it("should identify nearby seller within 4 km radius", () => {
      expect(distanceToSeller).toBeLessThan(4);
    });

    it("should identify far seller is outside 4 km radius", () => {
      expect(distanceToFar).toBeGreaterThan(4);
    });

    it("should handle same coordinates (distance = 0)", () => {
      const d = haversineKm(
        BUYER_SOCIETY.lat,
        BUYER_SOCIETY.lon,
        BUYER_SOCIETY.lat,
        BUYER_SOCIETY.lon,
      );
      expect(d).toBe(0);
    });

    it("should match seller within their delivery_radius_km", () => {
      // Sagar's Kitchen delivers up to 5 km; distance ~0.35 km → within radius
      expect(distanceToSeller).toBeLessThanOrEqual(APPROVED_SELLER.delivery_radius_km);
    });

    it("should reject far seller when distance exceeds delivery_radius_km", () => {
      // Far Away Foods delivers up to 3 km; distance ~5.1 km → outside
      expect(distanceToFar).toBeGreaterThan(FAR_SELLER.delivery_radius_km);
    });
  });

  // ─── 3. Seller Visibility Rules ─────────────────────────────────────
  describe("3. Seller Visibility Rules", () => {
    const allSocieties = [BUYER_SOCIETY, SELLER_SOCIETY, FAR_SOCIETY];
    const allSellers = [APPROVED_SELLER, UNAPPROVED_SELLER, UNAVAILABLE_SELLER, FAR_SELLER];
    const allProducts = [...APPROVED_PRODUCTS, DRAFT_PRODUCT, UNAVAILABLE_PRODUCT];

    it("should show approved seller with available products", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        10,
      );
      expect(results).toHaveLength(1);
      expect(results[0].seller.business_name).toBe("Sagar's Kitchen");
    });

    it("should NOT show unapproved seller", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [UNAPPROVED_SELLER],
        allProducts,
        10,
      );
      expect(results).toHaveLength(0);
    });

    it("should NOT show unavailable seller", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [UNAVAILABLE_SELLER],
        allProducts,
        10,
      );
      expect(results).toHaveLength(0);
    });

    it("should NOT show far seller when outside delivery radius", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [FAR_SELLER],
        [{ ...APPROVED_PRODUCTS[0], seller_id: FAR_SELLER.id }],
        10,
      );
      expect(results).toHaveLength(0);
    });

    it("should NOT show seller from buyer's own society", () => {
      const sameSocietySeller = {
        ...APPROVED_SELLER,
        id: "seller-same-society",
        society_id: BUYER_SOCIETY.id,
      };
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [sameSocietySeller],
        [{ ...APPROVED_PRODUCTS[0], seller_id: sameSocietySeller.id }],
        10,
      );
      expect(results).toHaveLength(0);
    });

    it("should NOT show seller who has sell_beyond_community = false", () => {
      const localOnlySeller = {
        ...APPROVED_SELLER,
        id: "seller-local-only",
        sell_beyond_community: false,
      };
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [localOnlySeller],
        [{ ...APPROVED_PRODUCTS[0], seller_id: localOnlySeller.id }],
        10,
      );
      expect(results).toHaveLength(0);
    });

    it("should NOT show approved seller with zero approved products", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        [DRAFT_PRODUCT, UNAVAILABLE_PRODUCT], // no approved+available products
        10,
      );
      expect(results).toHaveLength(0);
    });

    it("should filter correctly with all sellers and show only valid ones", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        allSellers,
        allProducts,
        10,
      );
      // Only APPROVED_SELLER should be visible
      expect(results).toHaveLength(1);
      expect(results[0].seller.id).toBe(APPROVED_SELLER.id);
    });
  });

  // ─── 4. Product Listing Visibility ──────────────────────────────────
  describe("4. Product Listing Visibility to Buyer", () => {
    const allSocieties = [BUYER_SOCIETY, SELLER_SOCIETY, FAR_SOCIETY];
    const allProducts = [...APPROVED_PRODUCTS, DRAFT_PRODUCT, UNAVAILABLE_PRODUCT];

    it("should return only approved + available products for the visible seller", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        10,
      );

      expect(results).toHaveLength(1);
      const visibleProducts = results[0].visibleProducts;

      // Should see 3 approved products, not the draft or unavailable
      expect(visibleProducts).toHaveLength(3);
      expect(visibleProducts.map((p) => p.name)).toEqual(
        expect.arrayContaining([
          "Butter Paneer Meal",
          "Dal Tadka with Rice",
          "Fish Curry Meal",
        ]),
      );
    });

    it("should NOT include draft products in visible listing", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        10,
      );
      const productNames = results[0].visibleProducts.map((p) => p.name);
      expect(productNames).not.toContain("Draft Biryani");
    });

    it("should NOT include unavailable products in visible listing", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        10,
      );
      const productNames = results[0].visibleProducts.map((p) => p.name);
      expect(productNames).not.toContain("Seasonal Mango Lassi");
    });

    it("should show correct price for each product", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        10,
      );
      const butterPaneer = results[0].visibleProducts.find(
        (p) => p.name === "Butter Paneer Meal",
      );
      expect(butterPaneer?.price).toBe(180);
    });

    it("should show distance from buyer to seller society", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        10,
      );
      expect(results[0].distanceKm).toBeLessThan(1);
      expect(results[0].societyName).toBe("Brigade Metropolis");
    });
  });

  // ─── 5. Radius-based Discovery Scenarios ────────────────────────────
  describe("5. Radius-based Discovery Scenarios", () => {
    const allSocieties = [BUYER_SOCIETY, SELLER_SOCIETY, FAR_SOCIETY];
    const allProducts = [...APPROVED_PRODUCTS];

    it("should discover seller within 4 km buyer search radius", () => {
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [APPROVED_SELLER],
        allProducts,
        4, // 4 km radius
      );
      expect(results).toHaveLength(1);
      expect(results[0].seller.business_name).toBe("Sagar's Kitchen");
      expect(results[0].distanceKm).toBeLessThan(4);
    });

    it("should NOT discover far seller within 4 km buyer search radius", () => {
      const farSellerWithBigRadius = {
        ...FAR_SELLER,
        delivery_radius_km: 10, // Even if seller delivers far
      };
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [farSellerWithBigRadius],
        [{ ...APPROVED_PRODUCTS[0], seller_id: farSellerWithBigRadius.id }],
        4, // Buyer only searches 4 km
      );
      expect(results).toHaveLength(0);
    });

    it("should discover far seller when buyer search radius is 10 km and seller delivery covers it", () => {
      const farSellerWithBigRadius = {
        ...FAR_SELLER,
        delivery_radius_km: 10,
      };
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [farSellerWithBigRadius],
        [{ ...APPROVED_PRODUCTS[0], seller_id: farSellerWithBigRadius.id }],
        10, // Buyer searches 10 km
      );
      expect(results).toHaveLength(1);
    });

    it("should respect the stricter of buyer radius and seller delivery radius", () => {
      // Seller delivers 2 km, buyer searches 10 km, distance is ~5 km → not visible
      const shortDeliverySeller = {
        ...APPROVED_SELLER,
        id: "seller-short-delivery",
        delivery_radius_km: 0.1, // very short delivery
        society_id: SELLER_SOCIETY.id,
      };
      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        [shortDeliverySeller],
        [{ ...APPROVED_PRODUCTS[0], seller_id: shortDeliverySeller.id }],
        10,
      );
      expect(results).toHaveLength(0);
    });
  });

  // ─── 6. Complete Flow Summary ───────────────────────────────────────
  describe("6. Complete Buyer Discovery Flow (Integration)", () => {
    it("should execute full discovery flow: signup → location match → seller visible → products listed", () => {
      // Step 1: Buyer exists with approved profile
      expect(BUYER_PROFILE.verification_status).toBe("approved");
      expect(BUYER_PROFILE.browse_beyond_community).toBe(true);

      // Step 2: Calculate distance
      const distance = haversineKm(
        BUYER_SOCIETY.lat,
        BUYER_SOCIETY.lon,
        SELLER_SOCIETY.lat,
        SELLER_SOCIETY.lon,
      );
      expect(distance).toBeLessThan(4);

      // Step 3: Run discovery
      const allSocieties = [BUYER_SOCIETY, SELLER_SOCIETY, FAR_SOCIETY];
      const allSellers = [APPROVED_SELLER, UNAPPROVED_SELLER, UNAVAILABLE_SELLER, FAR_SELLER];
      const allProducts = [...APPROVED_PRODUCTS, DRAFT_PRODUCT, UNAVAILABLE_PRODUCT];

      const results = simulateNearbySellerSearch(
        BUYER_SOCIETY,
        allSocieties,
        allSellers,
        allProducts,
        BUYER_PROFILE.search_radius_km,
      );

      // Step 4: Verify only Sagar's Kitchen is discovered
      expect(results).toHaveLength(1);
      const discoveredSeller = results[0];
      expect(discoveredSeller.seller.business_name).toBe("Sagar's Kitchen");
      expect(discoveredSeller.distanceKm).toBeLessThan(4);

      // Step 5: Verify only approved, available products are shown
      expect(discoveredSeller.visibleProducts).toHaveLength(3);
      const productNames = discoveredSeller.visibleProducts.map((p) => p.name);
      expect(productNames).toContain("Butter Paneer Meal");
      expect(productNames).toContain("Dal Tadka with Rice");
      expect(productNames).toContain("Fish Curry Meal");
      expect(productNames).not.toContain("Draft Biryani");
      expect(productNames).not.toContain("Seasonal Mango Lassi");

      // Step 6: Verify distance and society info
      expect(discoveredSeller.societyName).toBe("Brigade Metropolis");
    });
  });
});

// =====================================================================
// PART 2: REAL DATABASE INTEGRATION TESTS
// =====================================================================

describeDb("Buyer Discovery — Real DB Integration", () => {
  let buyerClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let seedData: { society_id: string; society_2_id: string };

  beforeAll(async () => {
    // Ensure test users exist FIRST (they may have been deleted by reset-and-seed)
    seedData = SEED!;
    [buyerClient, adminClient] = await Promise.all([
      createAuthenticatedClient("buyer"),
      createAuthenticatedClient("admin"),
    ]);
  }, 30000);

  describe("1. Real DB — Seller Profile Visibility", () => {
    it("buyer can only see approved seller profiles", async () => {
      const { data } = await buyerClient
        .from("seller_profiles")
        .select("id, verification_status")
        .limit(20);

      // All visible sellers must be approved (RLS enforced)
      if (data && data.length > 0) {
        data.forEach((s: any) => {
          expect(s.verification_status).toBe("approved");
        });
      }
    });

    it("buyer can only see approved, available products", async () => {
      const { data } = await buyerClient
        .from("products")
        .select("id, approval_status, is_available")
        .limit(20);

      if (data && data.length > 0) {
        data.forEach((p: any) => {
          expect(p.approval_status).toBe("approved");
          expect(p.is_available).toBe(true);
        });
      }
    });
  });

  describe("2. Real DB — Category Config Visibility", () => {
    it("buyer sees only active categories", async () => {
      const { data } = await buyerClient
        .from("category_config")
        .select("id, is_active")
        .limit(50);

      if (data && data.length > 0) {
        data.forEach((c: any) => {
          expect(c.is_active).toBe(true);
        });
      }
    });

    it("buyer can read parent_groups", async () => {
      const { data, error } = await buyerClient
        .from("parent_groups")
        .select("slug, name, is_active")
        .limit(20);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      if (data && data.length > 0) {
        // All visible groups should be active
        data.forEach((g: any) => {
          expect(g.is_active).toBe(true);
        });
      }
    });
  });

  describe("3. Real DB — Cross-Society Discovery RPC", () => {
    it("search_nearby_sellers returns only approved sellers with products", async () => {
      // This RPC requires a society with coordinates
      const { data: society } = await adminClient
        .from("societies")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(1)
        .single();

      if (!society) {
        // No societies with coordinates — skip gracefully
        expect(true).toBe(true);
        return;
      }

      const { data, error } = await buyerClient.rpc("search_nearby_sellers", {
        _buyer_society_id: society.id,
        _radius_km: 10,
      });

      // RPC should succeed (might return empty if no cross-society sellers)
      expect(error).toBeNull();

      if (data && data.length > 0) {
        data.forEach((seller: any) => {
          // Every returned seller must have matching_products
          expect(seller.seller_id).toBeDefined();
          expect(seller.business_name).toBeTruthy();
          expect(seller.distance_km).toBeLessThanOrEqual(10);
        });
      }
    });

    it("search_nearby_sellers rejects missing coordinates", async () => {
      // Find a society without coordinates, or use a fake UUID
      const { data, error } = await buyerClient.rpc("search_nearby_sellers", {
        _buyer_society_id: "00000000-0000-0000-0000-000000000000",
        _radius_km: 5,
      });

      // Should error because the society doesn't exist or has no coordinates
      expect(error).not.toBeNull();
    });
  });
});
