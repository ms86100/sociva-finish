import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Test Module Definitions ──────────────────────────────────────────
// Each module generates N scenarios from combinatorial inputs

interface GeneratedScenario {
  name: string;
  module: string;
  description: string;
  priority: number;
  is_active: boolean;
  steps: any[];
  tags: string[];
}

// Common setup steps used across modules
function sellerSetupSteps(bizName: string, opts: Record<string, any> = {}) {
  return [
    {
      step_id: "setup_seller", label: "Create seller profile", action: "setup",
      table: "seller_profiles", actor: "service_role",
      params: {
        row: {
          user_id: "{{seller_user.id}}", business_name: bizName,
          categories: ["food"], seller_type: "society_resident",
          verification_status: "approved", is_available: true,
          accepts_cod: true, accepts_upi: true, upi_id: "test@upi",
          fulfillment_mode: "self_pickup", delivery_radius_km: 10,
          sell_beyond_community: true, ...opts,
        },
      },
      on_fail: "abort",
    },
  ];
}

function productStep(stepId: string, label: string, name: string, price: number, category: string, extras: Record<string, any> = {}) {
  return {
    step_id: stepId, label, action: "insert", table: "products", actor: "service_role",
    params: {
      row: {
        seller_id: "{{setup_seller.id}}", name, price, category,
        is_available: true, approval_status: "approved", action_type: "buy",
        stock_quantity: 50, ...extras,
      },
    },
    on_fail: "abort",
  };
}

function cartStep(stepId: string, label: string, productRef: string, qty: number = 1) {
  return {
    step_id: stepId, label, action: "insert", table: "cart_items", actor: "buyer",
    params: { row: { user_id: "{{buyer_user.id}}", product_id: `{{${productRef}.id}}`, quantity: qty } },
    on_fail: "abort",
  };
}

function orderRpcStep(
  stepId: string, label: string, payMethod: string, payStatus: string,
  items: { ref: string; price: number; name: string; qty?: number }[],
  extras: Record<string, any> = {}
) {
  const sellerItems = items.map(i => ({
    product_id: `{{${i.ref}.id}}`, quantity: i.qty || 1, unit_price: i.price, product_name: i.name,
  }));
  const subtotal = items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  return {
    step_id: stepId, label, action: "rpc", actor: "buyer",
    params: {
      function_name: "create_multi_vendor_orders",
      args: {
        _buyer_id: "{{buyer_user.id}}", _payment_method: payMethod,
        _payment_status: payStatus, _delivery_address: "Test Flat 101",
        _notes: "Auto-generated test", _cart_total: subtotal,
        _seller_groups: [{ seller_id: "{{setup_seller.id}}", items: sellerItems, subtotal }],
        _idempotency_key: `scenario-${stepId}-{{buyer_user.id}}-{{setup_seller.id}}`,
        ...extras,
      },
    },
    expect: { status: "success" }, on_fail: "abort",
  };
}

// ─── Module: Cart Operations ──────────────────────────────────────────
function generateCartScenarios(): GeneratedScenario[] {
  const scenarios: GeneratedScenario[] = [];
  let p = 100;

  const quantities = [1, 2, 5, 10, 99];
  const categories = ["food", "groceries", "bakery", "snacks"];

  // Cart add with various quantities
  for (const qty of quantities) {
    for (const cat of categories) {
      scenarios.push({
        name: `Cart: Add ${cat} item qty=${qty}`,
        module: "cart", description: `Add ${cat} product with quantity ${qty} to cart`,
        priority: p++, is_active: true, tags: ["cart", "add", cat],
        steps: [
          ...sellerSetupSteps(`Cart Store ${cat}`),
          productStep("product", `Create ${cat} product`, `Test ${cat}`, 100, cat),
          cartStep("add", `Add to cart qty=${qty}`, "product", qty),
          {
            step_id: "verify", label: "Verify cart item", action: "select", table: "cart_items",
            actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
            expect: { status: "success", row_count: 1, field_checks: { quantity: qty } }, on_fail: "abort",
          },
        ],
      });
    }
  }

  // Cart update quantities
  const updateQtys = [1, 3, 10, 50, 0];
  for (const newQty of updateQtys) {
    scenarios.push({
      name: `Cart: Update quantity to ${newQty}`,
      module: "cart", description: `Update cart item quantity to ${newQty}`,
      priority: p++, is_active: true, tags: ["cart", "update"],
      steps: [
        ...sellerSetupSteps("Cart Update Store"),
        productStep("product", "Create product", "Update Test", 100, "food"),
        cartStep("add", "Add to cart", "product", 1),
        {
          step_id: "update", label: `Update qty to ${newQty}`, action: "update", table: "cart_items",
          actor: "buyer", params: { set: { quantity: newQty }, match: { id: "{{add.id}}" } },
          expect: { status: "success" }, on_fail: "abort",
        },
        {
          step_id: "verify", label: "Verify quantity", action: "select", table: "cart_items",
          actor: "buyer", params: { filters: { id: "{{add.id}}" } },
          expect: { status: "success", row_count: 1, field_checks: { quantity: newQty } }, on_fail: "abort",
        },
      ],
    });
  }

  // Duplicate cart item (should fail with unique constraint)
  scenarios.push({
    name: "Cart: Duplicate item rejection",
    module: "cart", description: "Adding same product twice should fail (unique constraint)",
    priority: p++, is_active: true, tags: ["cart", "duplicate", "constraint"],
    steps: [
      ...sellerSetupSteps("Cart Dup Store"),
      productStep("product", "Create product", "Dup Test", 100, "food"),
      cartStep("first", "First add", "product", 1),
      { ...cartStep("second", "Second add (expect rejection)", "product", 1), expect: { status: "error" }, on_fail: "continue" },
      {
        step_id: "verify", label: "Verify only 1 row", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      },
    ],
  });

  // Cart remove item
  scenarios.push({
    name: "Cart: Remove single item",
    module: "cart", description: "Remove specific item from cart",
    priority: p++, is_active: true, tags: ["cart", "remove"],
    steps: [
      ...sellerSetupSteps("Cart Remove Store"),
      productStep("product", "Create product", "Remove Test", 100, "food"),
      cartStep("add", "Add to cart", "product"),
      {
        step_id: "remove", label: "Remove from cart", action: "delete", table: "cart_items",
        actor: "buyer", params: { match: { id: "{{add.id}}" } }, expect: { status: "success" }, on_fail: "abort",
      },
      {
        step_id: "verify", label: "Cart is empty", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
        expect: { status: "success", row_count: 0 }, on_fail: "abort",
      },
    ],
  });

  // Multi-item cart (2-6 items)
  for (const count of [2, 3, 4, 5, 6]) {
    const steps: any[] = [...sellerSetupSteps("Multi Cart Store")];
    for (let i = 1; i <= count; i++) {
      steps.push(productStep(`p${i}`, `Create product ${i}`, `Multi Item ${i}`, 50 + i * 10, "food"));
    }
    for (let i = 1; i <= count; i++) {
      steps.push(cartStep(`c${i}`, `Add product ${i} to cart`, `p${i}`));
    }
    steps.push({
      step_id: "verify", label: `Verify ${count} cart items`, action: "select", table: "cart_items",
      actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}" } },
      expect: { status: "success" }, on_fail: "abort",
    });
    scenarios.push({
      name: `Cart: ${count}-item cart`, module: "cart",
      description: `Add ${count} different products to cart`, priority: p++, is_active: true,
      tags: ["cart", "multi-item"],
      steps,
    });
  }

  // Clear entire cart
  scenarios.push({
    name: "Cart: Clear all items",
    module: "cart", description: "Add items then delete all",
    priority: p++, is_active: true, tags: ["cart", "clear"],
    steps: [
      ...sellerSetupSteps("Cart Clear Store"),
      productStep("product", "Create product", "Clear Test", 100, "food"),
      cartStep("add", "Add to cart", "product", 3),
      {
        step_id: "clear", label: "Clear cart", action: "delete", table: "cart_items",
        actor: "buyer", params: { match: { user_id: "{{buyer_user.id}}" } }, expect: { status: "success" }, on_fail: "abort",
      },
      {
        step_id: "verify", label: "Cart is empty", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}" } },
        expect: { status: "success", row_count: 0 }, on_fail: "abort",
      },
    ],
  });

  return scenarios;
}

// ─── Module: Checkout Flows ───────────────────────────────────────────
function generateCheckoutScenarios(): GeneratedScenario[] {
  const scenarios: GeneratedScenario[] = [];
  let p = 300;

  const paymentMethods = [
    { method: "cod", status: "paid", label: "COD" },
    { method: "upi", status: "pending", label: "UPI" },
  ];

  const fulfillmentTypes = ["self_pickup", "delivery", "seller_delivery"];
  const categories = ["food", "groceries", "bakery", "snacks"];
  const itemCounts = [1, 2, 3, 5];

  // Payment × Fulfillment × Category × Item count
  for (const pay of paymentMethods) {
    for (const fulfillment of fulfillmentTypes) {
      for (const cat of categories) {
        for (const count of itemCounts) {
          const steps: any[] = [
            ...sellerSetupSteps(`Checkout ${pay.label} ${fulfillment}`, {
              fulfillment_mode: fulfillment,
              accepts_cod: pay.method === "cod",
              accepts_upi: pay.method === "upi",
            }),
          ];

          const items: { ref: string; price: number; name: string }[] = [];
          for (let i = 1; i <= count; i++) {
            steps.push(productStep(`p${i}`, `Create ${cat} product ${i}`, `${cat} Item ${i}`, 80 + i * 20, cat));
            steps.push(cartStep(`c${i}`, `Add product ${i}`, `p${i}`));
            items.push({ ref: `p${i}`, price: 80 + i * 20, name: `${cat} Item ${i}` });
          }

          const expectedStatus = pay.status === "pending" ? "payment_pending" : "placed";

          steps.push(orderRpcStep("place", `Place ${pay.label} order`, pay.method, pay.status, items, {
            _fulfillment_type: fulfillment,
          }));

          steps.push({
            step_id: "verify", label: `Verify order status = ${expectedStatus}`,
            action: "select", table: "orders", actor: "service_role",
            params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}", status: expectedStatus } },
            expect: { status: "success", row_count: 1, field_checks: { status: expectedStatus } },
            on_fail: "abort",
          });

          if (pay.method === "upi") {
            steps.push({
              step_id: "confirm_upi", label: "Confirm UPI payment",
              action: "rpc", actor: "buyer",
              params: { function_name: "confirm_upi_payment", args: { _order_id: "{{verify.0.id}}", _upi_transaction_ref: `TEST-UTR-${Date.now()}` } },
              expect: { status: "success" }, on_fail: "abort",
            });
            steps.push({
              step_id: "verify_placed", label: "Verify order placed after UPI",
              action: "select", table: "orders", actor: "buyer",
              params: { filters: { id: "{{verify.0.id}}" }, columns: "id,status", single: true },
              expect: { status: "success", field_checks: { status: "placed" } }, on_fail: "abort",
            });
          }

          scenarios.push({
            name: `Checkout: ${pay.label}/${fulfillment}/${cat}/${count}item`,
            module: "checkout",
            description: `${count} ${cat} items via ${pay.label}, ${fulfillment} fulfillment`,
            priority: p++, is_active: true,
            tags: ["checkout", pay.method, fulfillment, cat],
            steps,
          });
        }
      }
    }
  }

  return scenarios;
}

// ─── Module: Order Lifecycle ──────────────────────────────────────────
function generateOrderLifecycleScenarios(): GeneratedScenario[] {
  const scenarios: GeneratedScenario[] = [];
  let p = 600;

  // Cancellation at various stages
  const cancelFromStatuses: Array<{ status: string; needsTransition: string[] }> = [
    { status: "placed", needsTransition: [] },
    { status: "accepted", needsTransition: ["accepted"] },
    { status: "payment_pending", needsTransition: [] },
  ];

  for (const cancel of cancelFromStatuses) {
    const steps: any[] = [
      ...sellerSetupSteps("Lifecycle Cancel Store"),
      productStep("product", "Create product", "Lifecycle Item", 150, "food"),
      cartStep("cart", "Add to cart", "product"),
    ];

    if (cancel.status === "payment_pending") {
      steps.push(orderRpcStep("place", "Place UPI order", "upi", "pending", [{ ref: "product", price: 150, name: "Lifecycle Item" }]));
      steps.push({
        step_id: "get_order", label: "Get order", action: "select", table: "orders", actor: "service_role",
        params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}", status: "payment_pending" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      });
      steps.push({
        step_id: "cancel", label: "Cancel pending orders", action: "rpc", actor: "buyer",
        params: { function_name: "buyer_cancel_pending_orders", args: { _order_ids: ["{{get_order.0.id}}"] } },
        expect: { status: "success" }, on_fail: "abort",
      });
    } else {
      steps.push(orderRpcStep("place", "Place COD order", "cod", "paid", [{ ref: "product", price: 150, name: "Lifecycle Item" }]));
      steps.push({
        step_id: "get_order", label: "Get order", action: "select", table: "orders", actor: "service_role",
        params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}", status: "placed" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      });

      for (const status of cancel.needsTransition) {
        steps.push({
          step_id: `to_${status}`, label: `Transition to ${status}`, action: "update",
          table: "orders", actor: "service_role",
          params: { set: { status }, match: { id: "{{get_order.0.id}}" } },
          expect: { status: "success" }, on_fail: "abort",
        });
      }

      steps.push({
        step_id: "cancel", label: `Cancel from ${cancel.status}`, action: "rpc", actor: "buyer",
        params: { function_name: "buyer_cancel_order", args: { _order_id: "{{get_order.0.id}}", _reason: "Test cancel" } },
        expect: { status: "success" }, on_fail: "abort",
      });
    }

    steps.push({
      step_id: "verify_cancelled", label: "Verify cancelled", action: "select",
      table: "orders", actor: "service_role",
      params: { filters: { id: "{{get_order.0.id}}" }, columns: "id,status", single: true },
      expect: { status: "success", field_checks: { status: "cancelled" } }, on_fail: "abort",
    });

    scenarios.push({
      name: `Lifecycle: Cancel from ${cancel.status}`,
      module: "lifecycle", description: `Cancel order from ${cancel.status} status`,
      priority: p++, is_active: true, tags: ["lifecycle", "cancel", cancel.status],
      steps,
    });
  }

  // Full lifecycle: placed → accepted → preparing → ready → buyer_received
  const lifecyclePaths = [
    { name: "Self-Pickup", transitions: ["accepted", "preparing", "ready_for_pickup"], buyerAction: "buyer_received", fulfillment: "self_pickup" },
  ];

  for (const path of lifecyclePaths) {
    const steps: any[] = [
      ...sellerSetupSteps(`Lifecycle ${path.name}`, { fulfillment_mode: path.fulfillment }),
      productStep("product", "Create product", "Lifecycle Full Item", 200, "food"),
      cartStep("cart", "Add to cart", "product"),
      orderRpcStep("place", "Place COD order", "cod", "paid", [{ ref: "product", price: 200, name: "Lifecycle Full Item" }], { _fulfillment_type: path.fulfillment }),
      {
        step_id: "get_order", label: "Get order", action: "select", table: "orders", actor: "service_role",
        params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}", status: "placed" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      },
    ];

    for (const status of path.transitions) {
      steps.push({
        step_id: `to_${status}`, label: `Seller → ${status}`, action: "update",
        table: "orders", actor: "service_role",
        params: { set: { status }, match: { id: "{{get_order.0.id}}" } },
        expect: { status: "success" }, on_fail: "abort",
      });
    }

    if (path.buyerAction) {
      steps.push({
        step_id: "buyer_action", label: `Buyer → ${path.buyerAction}`, action: "rpc", actor: "buyer",
        params: { function_name: "buyer_advance_order", args: { _order_id: "{{get_order.0.id}}", _new_status: path.buyerAction } },
        expect: { status: "success" }, on_fail: "abort",
      });
    }

    scenarios.push({
      name: `Lifecycle: Full ${path.name} flow`,
      module: "lifecycle", description: `Complete ${path.name} lifecycle`,
      priority: p++, is_active: true, tags: ["lifecycle", "full", path.fulfillment],
      steps,
    });
  }

  // Invalid transitions (should fail)
  const invalidTransitions = [
    { from: "placed", to: "completed", label: "Skip to completed" },
    { from: "placed", to: "delivered", label: "Skip to delivered" },
    { from: "cancelled", to: "accepted", label: "Revive cancelled order" },
    { from: "accepted", to: "placed", label: "Revert to placed" },
  ];

  for (const t of invalidTransitions) {
    scenarios.push({
      name: `Lifecycle: Invalid ${t.from}→${t.to}`,
      module: "lifecycle", description: `${t.label} — should fail validation`,
      priority: p++, is_active: true, tags: ["lifecycle", "invalid", "negative"],
      steps: [
        ...sellerSetupSteps("Lifecycle Invalid Store"),
        productStep("product", "Create product", "Invalid Trans", 100, "food"),
        cartStep("cart", "Add to cart", "product"),
        orderRpcStep("place", "Place COD order", "cod", "paid", [{ ref: "product", price: 100, name: "Invalid Trans" }]),
        {
          step_id: "get_order", label: "Get order", action: "select", table: "orders", actor: "service_role",
          params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}", status: "placed" } },
          expect: { status: "success", row_count: 1 }, on_fail: "abort",
        },
        ...(t.from !== "placed" ? [{
          step_id: "transition_to_from", label: `Move to ${t.from}`, action: "update" as const,
          table: "orders", actor: "service_role",
          params: { set: { status: t.from }, match: { id: "{{get_order.0.id}}" } },
          expect: { status: "success" }, on_fail: "abort",
        }] : []),
        {
          step_id: "invalid_transition", label: `Invalid: ${t.from}→${t.to}`, action: "update",
          table: "orders", actor: "service_role",
          params: { set: { status: t.to }, match: { id: "{{get_order.0.id}}" } },
          expect: { status: "error" }, on_fail: "continue",
        },
      ],
    });
  }

  return scenarios;
}

// ─── Module: RLS & Access Control ─────────────────────────────────────
function generateRLSScenarios(): GeneratedScenario[] {
  const scenarios: GeneratedScenario[] = [];
  let p = 800;

  // Buyer cannot read other buyer's cart
  scenarios.push({
    name: "RLS: Buyer cannot see other buyer cart",
    module: "rls", description: "Buyer's cart query should only return own items",
    priority: p++, is_active: true, tags: ["rls", "cart", "isolation"],
    steps: [
      ...sellerSetupSteps("RLS Cart Store"),
      productStep("product", "Create product", "RLS Item", 100, "food"),
      cartStep("add", "Buyer adds to cart", "product"),
      {
        step_id: "guard_check", label: "Guard cannot see buyer cart",
        action: "select", table: "cart_items", actor: "guard",
        params: { filters: { user_id: "{{buyer_user.id}}" } },
        expect: { status: "success", row_count: 0 }, on_fail: "abort",
      },
    ],
  });

  // Buyer cannot update another buyer's order
  scenarios.push({
    name: "RLS: Buyer cannot cancel other's order",
    module: "rls", description: "Buyer should not be able to cancel another user's order",
    priority: p++, is_active: true, tags: ["rls", "orders", "isolation"],
    steps: [
      ...sellerSetupSteps("RLS Order Store"),
      productStep("product", "Create product", "RLS Order", 100, "food"),
      cartStep("cart", "Add to cart", "product"),
      orderRpcStep("place", "Place order", "cod", "paid", [{ ref: "product", price: 100, name: "RLS Order" }]),
      {
        step_id: "get_order", label: "Get order", action: "select", table: "orders", actor: "service_role",
        params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}", status: "placed" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      },
      {
        step_id: "guard_cancel", label: "Guard tries to cancel buyer's order (should fail)",
        action: "rpc", actor: "guard",
        params: { function_name: "buyer_cancel_order", args: { _order_id: "{{get_order.0.id}}", _reason: "Unauthorized" } },
        expect: { status: "error" }, on_fail: "continue",
      },
    ],
  });

  // Buyer cannot see admin_settings
  scenarios.push({
    name: "RLS: Buyer cannot read admin_settings",
    module: "rls", description: "admin_settings should be blocked for non-admin users",
    priority: p++, is_active: true, tags: ["rls", "admin", "blocked"],
    steps: [{
      step_id: "read_settings", label: "Buyer reads admin_settings",
      action: "select", table: "admin_settings", actor: "buyer", params: { limit: 1 },
      expect: { status: "success", row_count: 0 }, on_fail: "abort",
    }],
  });

  // Buyer cannot see user_roles
  scenarios.push({
    name: "RLS: Buyer cannot read user_roles",
    module: "rls", description: "user_roles should be blocked for non-admin users",
    priority: p++, is_active: true, tags: ["rls", "roles", "blocked"],
    steps: [{
      step_id: "read_roles", label: "Buyer reads user_roles",
      action: "select", table: "user_roles", actor: "buyer", params: { limit: 10 },
      expect: { status: "success", row_count: 0 }, on_fail: "abort",
    }],
  });

  // Buyer cannot delete products
  scenarios.push({
    name: "RLS: Buyer cannot delete products",
    module: "rls", description: "Buyer should not be able to delete any product",
    priority: p++, is_active: true, tags: ["rls", "products", "blocked"],
    steps: [
      ...sellerSetupSteps("RLS Delete Store"),
      productStep("product", "Create product", "Undeletable", 100, "food"),
      {
        step_id: "delete_attempt", label: "Buyer tries to delete product (should fail)",
        action: "delete", table: "products", actor: "buyer",
        params: { match: { id: "{{product.id}}" } },
        expect: { status: "success", row_count: 0 }, on_fail: "abort",
      },
      {
        step_id: "verify_exists", label: "Product still exists",
        action: "select", table: "products", actor: "buyer",
        params: { filters: { id: "{{product.id}}" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      },
    ],
  });

  // Cross-society product visibility
  scenarios.push({
    name: "RLS: Cross-society product visibility",
    module: "rls", description: "Buyer from different society can see approved products",
    priority: p++, is_active: true, tags: ["rls", "cross-society", "visibility"],
    steps: [
      ...sellerSetupSteps("Cross Society Store", { sell_beyond_community: true }),
      productStep("product", "Create approved product", "Cross Society Item", 200, "food"),
      {
        step_id: "buyer_sees", label: "Buyer can see product",
        action: "select", table: "products", actor: "buyer",
        params: { filters: { id: "{{product.id}}", is_available: true, approval_status: "approved" } },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      },
    ],
  });

  return scenarios;
}

// ─── Module: Edge Cases & Error Handling ───────────────────────────────
function generateEdgeCaseScenarios(): GeneratedScenario[] {
  const scenarios: GeneratedScenario[] = [];
  let p = 900;

  // Zero-price product
  scenarios.push({
    name: "Edge: Zero-price product checkout",
    module: "edge_cases", description: "Can a buyer checkout with a free product?",
    priority: p++, is_active: true, tags: ["edge", "price", "zero"],
    steps: [
      ...sellerSetupSteps("Edge Zero Store"),
      productStep("product", "Create free product", "Free Sample", 0, "food"),
      cartStep("cart", "Add free product", "product"),
      orderRpcStep("place", "Place COD order with free item", "cod", "paid", [{ ref: "product", price: 0, name: "Free Sample" }]),
      {
        step_id: "verify", label: "Verify order created", action: "select", table: "orders", actor: "service_role",
        params: { filters: { buyer_id: "{{buyer_user.id}}", seller_id: "{{setup_seller.id}}" }, limit: 1 },
        expect: { status: "success", row_count: 1 }, on_fail: "abort",
      },
    ],
  });

  // Very high quantity
  scenarios.push({
    name: "Edge: Cart with quantity 9999",
    module: "edge_cases", description: "Add item with extremely high quantity",
    priority: p++, is_active: true, tags: ["edge", "quantity", "limit"],
    steps: [
      ...sellerSetupSteps("Edge Qty Store"),
      productStep("product", "Create product", "Bulk Item", 10, "food", { stock_quantity: 10000 }),
      cartStep("cart", "Add qty 9999", "product", 9999),
      {
        step_id: "verify", label: "Verify high qty", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
        expect: { status: "success", row_count: 1, field_checks: { quantity: 9999 } }, on_fail: "abort",
      },
    ],
  });

  // Unavailable product (is_available = false)
  scenarios.push({
    name: "Edge: Cart add unavailable product",
    module: "edge_cases", description: "Can buyer add an unavailable product to cart?",
    priority: p++, is_active: true, tags: ["edge", "availability"],
    steps: [
      ...sellerSetupSteps("Edge Unavail Store"),
      productStep("product", "Create unavailable product", "Unavailable", 100, "food", { is_available: false }),
      cartStep("cart", "Add unavailable product to cart", "product"),
      {
        step_id: "verify", label: "Check if cart accepted it", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
        expect: { status: "success" }, on_fail: "abort",
      },
    ],
  });

  // Unapproved product
  scenarios.push({
    name: "Edge: Cart add unapproved product",
    module: "edge_cases", description: "Can buyer add a pending-approval product to cart?",
    priority: p++, is_active: true, tags: ["edge", "approval"],
    steps: [
      ...sellerSetupSteps("Edge Unapproved Store"),
      productStep("product", "Create unapproved product", "Pending Review", 100, "food", { approval_status: "pending" }),
      cartStep("cart", "Add unapproved product to cart", "product"),
      {
        step_id: "verify", label: "Check if cart accepted it", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
        expect: { status: "success" }, on_fail: "abort",
      },
    ],
  });

  // Out of stock product (stock = 0)
  scenarios.push({
    name: "Edge: Cart add out-of-stock product",
    module: "edge_cases", description: "Can buyer add an out-of-stock product to cart?",
    priority: p++, is_active: true, tags: ["edge", "stock"],
    steps: [
      ...sellerSetupSteps("Edge OOS Store"),
      productStep("product", "Create zero-stock product", "Sold Out", 100, "food", { stock_quantity: 0 }),
      cartStep("cart", "Add zero-stock product to cart", "product"),
      {
        step_id: "verify", label: "Check if cart accepted it", action: "select", table: "cart_items",
        actor: "buyer", params: { filters: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}" } },
        expect: { status: "success" }, on_fail: "abort",
      },
    ],
  });

  // Negative quantity
  scenarios.push({
    name: "Edge: Cart negative quantity",
    module: "edge_cases", description: "What happens with negative quantity?",
    priority: p++, is_active: true, tags: ["edge", "quantity", "negative"],
    steps: [
      ...sellerSetupSteps("Edge Neg Store"),
      productStep("product", "Create product", "Neg Qty Test", 100, "food"),
      { ...cartStep("cart", "Add with qty -1", "product", -1), on_fail: "continue" },
    ],
  });

  // Double order (idempotency test)
  scenarios.push({
    name: "Edge: Double order placement (idempotency)",
    module: "edge_cases", description: "Placing same order twice should be caught by idempotency",
    priority: p++, is_active: true, tags: ["edge", "idempotency", "duplicate"],
    steps: [
      ...sellerSetupSteps("Edge Idemp Store"),
      productStep("product", "Create product", "Idemp Test", 100, "food"),
      cartStep("cart", "Add to cart", "product"),
      orderRpcStep("order1", "Place first order", "cod", "paid", [{ ref: "product", price: 100, name: "Idemp Test" }]),
      {
        step_id: "cart2", label: "Re-add to cart", action: "insert", table: "cart_items", actor: "buyer",
        params: { row: { user_id: "{{buyer_user.id}}", product_id: "{{product.id}}", quantity: 1 } },
        on_fail: "continue",
      },
      {
        ...orderRpcStep("order2", "Place second order (should work — different idempotency key)", "cod", "paid", [{ ref: "product", price: 100, name: "Idemp Test" }]),
        on_fail: "continue",
      },
    ],
  });

  // Seller unavailable
  scenarios.push({
    name: "Edge: Checkout with offline seller",
    module: "edge_cases", description: "What happens when seller is_available=false during checkout?",
    priority: p++, is_active: true, tags: ["edge", "seller", "offline"],
    steps: [
      ...sellerSetupSteps("Edge Offline Store", { is_available: false }),
      productStep("product", "Create product", "Offline Seller Item", 100, "food"),
      cartStep("cart", "Add to cart", "product"),
      {
        ...orderRpcStep("place", "Place order with offline seller", "cod", "paid", [{ ref: "product", price: 100, name: "Offline Seller Item" }]),
        on_fail: "continue",
      },
    ],
  });

  return scenarios;
}

// ─── Main Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  // Auth check
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const modules = body.modules || ["cart", "checkout", "lifecycle", "rls", "edge_cases"];
    const clearExisting = body.clear_existing !== false;

    // Generate scenarios
    const allScenarios: GeneratedScenario[] = [];
    if (modules.includes("cart")) allScenarios.push(...generateCartScenarios());
    if (modules.includes("checkout")) allScenarios.push(...generateCheckoutScenarios());
    if (modules.includes("lifecycle")) allScenarios.push(...generateOrderLifecycleScenarios());
    if (modules.includes("rls")) allScenarios.push(...generateRLSScenarios());
    if (modules.includes("edge_cases")) allScenarios.push(...generateEdgeCaseScenarios());

    // Clear existing auto-generated scenarios if requested
    if (clearExisting) {
      await adminClient.from("test_scenarios")
        .delete()
        .not("tags", "is", null);
    }

    // Insert in batches of 50
    let inserted = 0;
    for (let i = 0; i < allScenarios.length; i += 50) {
      const batch = allScenarios.slice(i, i + 50);
      const { error } = await adminClient.from("test_scenarios").insert(batch);
      if (error) {
        console.error(`Batch insert error at ${i}:`, error);
      } else {
        inserted += batch.length;
      }
    }

    // Count by module
    const moduleCounts: Record<string, number> = {};
    for (const s of allScenarios) {
      moduleCounts[s.module] = (moduleCounts[s.module] || 0) + 1;
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_generated: allScenarios.length,
        total_inserted: inserted,
        by_module: moduleCounts,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Generate error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
