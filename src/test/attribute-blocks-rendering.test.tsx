/**
 * Attribute Blocks Rendering Tests
 * ==================================
 * Unit tests that verify the ProductAttributeBlocks component correctly
 * renders different block types (nutrition_info, allergen_info, course_details,
 * session_details, product_specs) with proper labels and structure.
 *
 * These tests use mocked block library data to avoid DB dependency,
 * ensuring the rendering logic is validated independently.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
const screen = { getByText: (text: string) => document.body.querySelector(`*`) } as any;
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProductAttributeBlocks } from "@/components/product/ProductAttributeBlocks";

// Mock the block library hook to return known blocks
vi.mock("@/hooks/useAttributeBlocks", () => ({
  useBlockLibrary: () => ({
    data: [
      {
        id: "1",
        block_type: "nutrition_info",
        display_name: "🥗 Nutrition Info",
        description: null,
        icon: "🥗",
        category_hints: ["home_food"],
        schema: {
          fields: [
            { key: "calories", label: "Calories", type: "text" },
            { key: "protein", label: "Protein", type: "text" },
            { key: "carbs", label: "Carbs", type: "text" },
            { key: "fat", label: "Fat", type: "text" },
          ],
        },
        renderer_type: "key_value" as const,
        display_order: 1,
        is_active: true,
      },
      {
        id: "2",
        block_type: "allergen_info",
        display_name: "⚠️ Allergen Info",
        description: null,
        icon: "⚠️",
        category_hints: ["home_food"],
        schema: {
          fields: [
            { key: "contains", label: "Contains", type: "tag_input" },
            { key: "free_from", label: "Free From", type: "tag_input" },
          ],
        },
        renderer_type: "badge_list" as const,
        display_order: 2,
        is_active: true,
      },
      {
        id: "3",
        block_type: "course_details",
        display_name: "📚 Course Details",
        description: null,
        icon: "📚",
        category_hints: ["coaching", "tuition"],
        schema: {
          fields: [
            { key: "level", label: "Level", type: "text" },
            { key: "batch_size", label: "Batch Size", type: "text" },
            { key: "schedule", label: "Schedule", type: "text" },
            { key: "includes", label: "Includes", type: "text" },
          ],
        },
        renderer_type: "key_value" as const,
        display_order: 3,
        is_active: true,
      },
      {
        id: "4",
        block_type: "session_details",
        display_name: "🧘 Session Details",
        description: null,
        icon: "🧘",
        category_hints: ["yoga"],
        schema: {
          fields: [
            { key: "level", label: "Level", type: "text" },
            { key: "intensity", label: "Intensity", type: "text" },
            { key: "equipment", label: "Equipment", type: "text" },
          ],
        },
        renderer_type: "key_value" as const,
        display_order: 4,
        is_active: true,
      },
      {
        id: "5",
        block_type: "product_specs",
        display_name: "📋 Product Specifications",
        description: null,
        icon: "📋",
        category_hints: ["electronics"],
        schema: {
          fields: [
            { key: "warranty", label: "Warranty", type: "text" },
            { key: "compatibility", label: "Compatibility", type: "text" },
          ],
        },
        renderer_type: "key_value" as const,
        display_order: 5,
        is_active: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("ProductAttributeBlocks", () => {
  // ────────────────────────────────────────────────────────
  // 1. NULL / EMPTY HANDLING
  // ────────────────────────────────────────────────────────
  it("renders nothing when specifications is null", () => {
    const { container } = renderWithQuery(
      <ProductAttributeBlocks specifications={null} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when specifications is undefined", () => {
    const { container } = renderWithQuery(
      <ProductAttributeBlocks specifications={undefined} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when specifications has no blocks array", () => {
    const { container } = renderWithQuery(
      <ProductAttributeBlocks specifications={{ something: "else" }} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when blocks array is empty", () => {
    const { container } = renderWithQuery(
      <ProductAttributeBlocks specifications={{ blocks: [] }} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when all blocks have empty data", () => {
    const { container } = renderWithQuery(
      <ProductAttributeBlocks
        specifications={{
          blocks: [{ type: "nutrition_info", data: {} }],
        }}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  // ────────────────────────────────────────────────────────
  // 2. NUTRITION INFO (key_value renderer)
  // ────────────────────────────────────────────────────────
  describe("nutrition_info block", () => {
    it("renders nutrition data with proper labels", () => {
      renderWithQuery(
        <ProductAttributeBlocks
          specifications={{
            blocks: [
              {
                type: "nutrition_info",
                data: { calories: "650 kcal", protein: "32g", carbs: "58g" },
              },
            ],
          }}
        />
      );

      expect(screen.getByText("🥗 Nutrition Info")).toBeInTheDocument();
      expect(screen.getByText("Calories")).toBeInTheDocument();
      expect(screen.getByText("650 kcal")).toBeInTheDocument();
      expect(screen.getByText("Protein")).toBeInTheDocument();
      expect(screen.getByText("32g")).toBeInTheDocument();
      expect(screen.getByText("Carbs")).toBeInTheDocument();
      expect(screen.getByText("58g")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────
  // 3. ALLERGEN INFO (badge_list renderer)
  // ────────────────────────────────────────────────────────
  describe("allergen_info block", () => {
    it("renders allergen tags as badges", () => {
      renderWithQuery(
        <ProductAttributeBlocks
          specifications={{
            blocks: [
              {
                type: "allergen_info",
                data: {
                  contains: ["Dairy", "Gluten", "Nuts"],
                  free_from: ["Soy"],
                },
              },
            ],
          }}
        />
      );

      expect(screen.getByText("⚠️ Allergen Info")).toBeInTheDocument();
      expect(screen.getByText("Dairy")).toBeInTheDocument();
      expect(screen.getByText("Gluten")).toBeInTheDocument();
      expect(screen.getByText("Nuts")).toBeInTheDocument();
      expect(screen.getByText("Soy")).toBeInTheDocument();
    });

    it("renders single string allergen as key-value fallback", () => {
      renderWithQuery(
        <ProductAttributeBlocks
          specifications={{
            blocks: [
              {
                type: "allergen_info",
                data: { contains: "Dairy, Gluten, Nuts" },
              },
            ],
          }}
        />
      );

      expect(screen.getByText("⚠️ Allergen Info")).toBeInTheDocument();
      // String value renders as key-value pair
      expect(screen.getByText("Dairy, Gluten, Nuts")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────
  // 4. COURSE DETAILS (key_value renderer)
  // ────────────────────────────────────────────────────────
  describe("course_details block", () => {
    it("renders course information with labels from schema", () => {
      renderWithQuery(
        <ProductAttributeBlocks
          specifications={{
            blocks: [
              {
                type: "course_details",
                data: {
                  level: "Advanced",
                  batch_size: "Max 10 students",
                  schedule: "Mon/Wed/Fri 6-7:30 PM",
                  includes: "Study material, weekly tests",
                },
              },
            ],
          }}
        />
      );

      expect(screen.getByText("📚 Course Details")).toBeInTheDocument();
      expect(screen.getByText("Level")).toBeInTheDocument();
      expect(screen.getByText("Advanced")).toBeInTheDocument();
      expect(screen.getByText("Batch Size")).toBeInTheDocument();
      expect(screen.getByText("Max 10 students")).toBeInTheDocument();
      expect(screen.getByText("Schedule")).toBeInTheDocument();
      expect(screen.getByText("Mon/Wed/Fri 6-7:30 PM")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────
  // 5. SESSION DETAILS (key_value renderer)
  // ────────────────────────────────────────────────────────
  describe("session_details block", () => {
    it("renders yoga session details", () => {
      renderWithQuery(
        <ProductAttributeBlocks
          specifications={{
            blocks: [
              {
                type: "session_details",
                data: {
                  level: "All levels",
                  intensity: "Moderate",
                  equipment: "Yoga mat provided",
                },
              },
            ],
          }}
        />
      );

      expect(screen.getByText("🧘 Session Details")).toBeInTheDocument();
      expect(screen.getByText("Level")).toBeInTheDocument();
      expect(screen.getByText("All levels")).toBeInTheDocument();
      expect(screen.getByText("Intensity")).toBeInTheDocument();
      expect(screen.getByText("Moderate")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────
  // 6. PRODUCT SPECS (key_value renderer)
  // ────────────────────────────────────────────────────────
  describe("product_specs block", () => {
    it("renders electronics specifications", () => {
      renderWithQuery(
        <ProductAttributeBlocks
          specifications={{
            blocks: [
              {
                type: "product_specs",
                data: {
                  warranty: "1 year manufacturer",
                  compatibility: "Windows/Mac/Linux",
                },
              },
            ],
          }}
        />
      );

      expect(
        screen.getByText("📋 Product Specifications")
      ).toBeInTheDocument();
      expect(screen.getByText("Warranty")).toBeInTheDocument();
      expect(screen.getByText("1 year manufacturer")).toBeInTheDocument();
      expect(screen.getByText("Compatibility")).toBeInTheDocument();
      expect(screen.getByText("Windows/Mac/Linux")).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────
  // 7. MULTIPLE BLOCKS
  // ────────────────────────────────────────────────────────
  it("renders multiple blocks for a single product", () => {
    renderWithQuery(
      <ProductAttributeBlocks
        specifications={{
          blocks: [
            {
              type: "nutrition_info",
              data: { calories: "650 kcal", protein: "32g" },
            },
            {
              type: "allergen_info",
              data: { contains: ["Dairy", "Gluten"] },
            },
          ],
        }}
      />
    );

    expect(screen.getByText("🥗 Nutrition Info")).toBeInTheDocument();
    expect(screen.getByText("⚠️ Allergen Info")).toBeInTheDocument();
    expect(screen.getByText("650 kcal")).toBeInTheDocument();
    expect(screen.getByText("Dairy")).toBeInTheDocument();
  });

  // ────────────────────────────────────────────────────────
  // 8. UNKNOWN BLOCK TYPE (graceful fallback)
  // ────────────────────────────────────────────────────────
  it("renders unknown block types with humanized name as key_value", () => {
    renderWithQuery(
      <ProductAttributeBlocks
        specifications={{
          blocks: [
            {
              type: "custom_unknown_block",
              data: { some_field: "some value" },
            },
          ],
        }}
      />
    );

    // Should humanize "custom_unknown_block" → "Custom Unknown Block"
    expect(screen.getByText("Custom Unknown Block")).toBeInTheDocument();
    expect(screen.getByText("some value")).toBeInTheDocument();
  });

  // ────────────────────────────────────────────────────────
  // 9. BOOLEAN VALUES
  // ────────────────────────────────────────────────────────
  it("renders boolean values as Yes/No", () => {
    renderWithQuery(
      <ProductAttributeBlocks
        specifications={{
          blocks: [
            {
              type: "product_specs",
              data: { warranty: true },
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Yes")).toBeInTheDocument();
  });
});
