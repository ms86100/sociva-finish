import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SELLERS = 10;
const BATCH_PRODUCTS = 20;
const CONFIDENCE_APPROVE = 0.85;
const CONFIDENCE_REJECT = 0.30;
const AI_TIMEOUT_MS = 15000; // 15s timeout for AI calls

const PROHIBITED_CATEGORIES = [
  "alcohol",
  "tobacco",
  "pharmaceuticals",
  "weapons",
  "gambling",
];

/* ── helpers ── */

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

interface RuleResult {
  decision: "approved" | "rejected" | "flagged" | null;
  confidence: number;
  reason: string;
  ruleHits: string[];
}

/* ── Deterministic rules for sellers ── */
function evaluateSellerRules(seller: any): RuleResult {
  const hits: string[] = [];
  if (!seller.business_name?.trim()) {
    hits.push("missing_business_name");
    return { decision: "rejected", confidence: 1, reason: "Business name is missing.", ruleHits: hits };
  }
  if (!seller.categories || seller.categories.length === 0) {
    hits.push("missing_categories");
    return { decision: "rejected", confidence: 1, reason: "No categories specified.", ruleHits: hits };
  }
  for (const cat of seller.categories) {
    if (PROHIBITED_CATEGORIES.includes(cat?.toLowerCase?.())) {
      hits.push("prohibited_category");
      return { decision: "rejected", confidence: 1, reason: `Prohibited category: ${cat}`, ruleHits: hits };
    }
  }
  return { decision: null, confidence: 0, reason: "", ruleHits: hits };
}

/* ── Deterministic rules for products ── */
function evaluateProductRules(product: any): RuleResult {
  const hits: string[] = [];
  if (!product.name?.trim()) {
    hits.push("missing_name");
    return { decision: "rejected", confidence: 1, reason: "Product name is missing.", ruleHits: hits };
  }
  if (!product.category?.trim()) {
    hits.push("missing_category");
    return { decision: "rejected", confidence: 1, reason: "Product category is missing.", ruleHits: hits };
  }
  if (PROHIBITED_CATEGORIES.includes(product.category?.toLowerCase?.())) {
    hits.push("prohibited_category");
    return { decision: "rejected", confidence: 1, reason: `Prohibited category: ${product.category}`, ruleHits: hits };
  }
  const isCartItem = product.action_type === "add_to_cart" || product.action_type === "buy_now";
  if (isCartItem && (product.price == null || product.price <= 0)) {
    hits.push("invalid_price");
    return { decision: "rejected", confidence: 1, reason: "Price must be positive for purchasable items.", ruleHits: hits };
  }
  return { decision: null, confidence: 0, reason: "", ruleHits: hits };
}

/* ── AI evaluation via Lovable AI with timeout ── */
async function aiEvaluate(
  type: "seller" | "product",
  snapshot: any
): Promise<{ decision: string; confidence: number; reason: string }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  const systemPrompt = `You are an AI reviewer for an Indian community marketplace platform (Sociva).
Your job is to evaluate ${type === "seller" ? "seller applications" : "product listings"} and decide whether to approve, reject, or flag them.

Platform rules:
- This is a residential society marketplace in India
- Categories include groceries, food, services, electronics, clothing, etc.
- Prohibited: alcohol, tobacco, weapons, pharmaceuticals without license, gambling
- Sellers must have a legitimate business name and relevant categories
- Products must have appropriate names, descriptions, and pricing
- Flag anything suspicious but not clearly violating rules

For sellers: Check business name legitimacy, category relevance, completeness.
For products: Check name quality, price reasonableness (Indian market), category alignment, description quality.

Use the review_decision tool to return your structured decision.`;

  const userPrompt = `Review this ${type}:\n${JSON.stringify(snapshot, null, 2)}`;

  // AbortController for timeout safety
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "review_decision",
                description:
                  "Submit the review decision for this seller or product.",
                parameters: {
                  type: "object",
                  properties: {
                    decision: {
                      type: "string",
                      enum: ["approved", "rejected", "flagged"],
                      description: "The review decision",
                    },
                    confidence: {
                      type: "number",
                      description:
                        "Confidence score between 0 and 1",
                    },
                    reason: {
                      type: "string",
                      description:
                        "Human-readable explanation for the decision",
                    },
                  },
                  required: ["decision", "confidence", "reason"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "review_decision" },
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    // Validate AI response fields
    if (!args.decision || !["approved", "rejected", "flagged"].includes(args.decision)) {
      throw new Error(`Invalid AI decision: ${args.decision}`);
    }
    if (typeof args.confidence !== "number" || isNaN(args.confidence)) {
      throw new Error(`Invalid AI confidence: ${args.confidence}`);
    }

    return {
      decision: args.decision,
      confidence: Math.min(1, Math.max(0, Number(args.confidence))),
      reason: args.reason || "No reason provided",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ── Log + update status with optimistic locking ── */
async function processItem(
  db: ReturnType<typeof createClient>,
  type: "seller" | "product",
  item: any,
  societyId: string | null
): Promise<boolean> {
  const snapshot = { ...item };

  // 1) Deterministic rules
  const ruleResult =
    type === "seller"
      ? evaluateSellerRules(item)
      : evaluateProductRules(item);

  let finalDecision: string;
  let finalConfidence: number;
  let finalReason: string;
  let modelUsed: string | null = null;
  const ruleHits = ruleResult.ruleHits;

  if (ruleResult.decision) {
    finalDecision = ruleResult.decision;
    finalConfidence = ruleResult.confidence;
    finalReason = ruleResult.reason;
    modelUsed = "deterministic_rules";
  } else {
    // 2) Call AI
    try {
      const aiResult = await aiEvaluate(type, snapshot);
      modelUsed = "google/gemini-3-flash-preview";

      // 3) Apply thresholds
      if (aiResult.confidence >= CONFIDENCE_APPROVE && aiResult.decision === "approved") {
        finalDecision = "approved";
      } else if (aiResult.confidence <= CONFIDENCE_REJECT && aiResult.decision === "rejected") {
        finalDecision = "rejected";
      } else if (aiResult.decision === "rejected" && aiResult.confidence >= CONFIDENCE_APPROVE) {
        finalDecision = "rejected";
      } else {
        finalDecision = "flagged";
      }
      finalConfidence = aiResult.confidence;
      finalReason = aiResult.reason;
    } catch (err) {
      // AI failed — do NOT log, so item will be retried next cron run
      console.error(`AI evaluation failed for ${type} ${item.id}:`, err);
      return false;
    }
  }

  // 4) Log decision (UNIQUE index prevents duplicates — ON CONFLICT skip)
  const { error: logError } = await db.from("ai_review_log").insert({
    target_type: type,
    target_id: item.id,
    decision: finalDecision,
    confidence: finalConfidence,
    reason: finalReason,
    rule_hits: ruleHits,
    input_snapshot: snapshot,
    model_used: modelUsed,
    society_id: societyId,
  });

  // If duplicate (unique constraint violation), skip — already reviewed
  if (logError) {
    if (logError.code === "23505") {
      console.log(`Skipping duplicate review for ${type} ${item.id}`);
      return false;
    }
    console.error(`Log insert error for ${type} ${item.id}:`, logError);
    return false;
  }

  // 5) Optimistic lock: re-verify status is still "pending" before updating
  // This prevents overwriting admin decisions made between fetch and now
  if (finalDecision === "approved") {
    if (type === "seller") {
      const { data: current } = await db
        .from("seller_profiles")
        .select("verification_status")
        .eq("id", item.id)
        .single();
      if (current?.verification_status !== "pending") {
        console.log(`Seller ${item.id} status changed to ${current?.verification_status}, skipping AI update`);
        return true; // logged but not updated — safe
      }
      await db
        .from("seller_profiles")
        .update({ verification_status: "approved" })
        .eq("id", item.id)
        .eq("verification_status", "pending"); // double-check in WHERE
      // Cascade: approve all pending/draft products for this seller
      await db
        .from("products")
        .update({ approval_status: "approved" })
        .eq("seller_id", item.id)
        .in("approval_status", ["pending", "draft"]);
    } else {
      await db
        .from("products")
        .update({ approval_status: "approved" })
        .eq("id", item.id)
        .in("approval_status", ["pending", "draft"]); // only if still pending/draft
    }
  } else if (finalDecision === "rejected") {
    if (type === "seller") {
      await db
        .from("seller_profiles")
        .update({ verification_status: "rejected" })
        .eq("id", item.id)
        .eq("verification_status", "pending"); // only if still pending
    } else {
      await db
        .from("products")
        .update({ approval_status: "rejected" })
        .eq("id", item.id)
        .in("approval_status", ["pending", "draft"]); // only if still pending/draft
    }
  }
  // flagged → leave status as-is, admin can review

  return true;
}

/* ── Main handler ── */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const db = serviceClient();

    // Fetch pending sellers
    const { data: pendingSellers } = await db
      .from("seller_profiles")
      .select("*")
      .eq("verification_status", "pending")
      .limit(BATCH_SELLERS);

    // Filter out sellers already in ai_review_log (handles "flagged" items that remain pending)
    const sellerIds = (pendingSellers || []).map((s: any) => s.id);
    let reviewedSellerIds = new Set<string>();
    if (sellerIds.length > 0) {
      const { data: reviewed } = await db
        .from("ai_review_log")
        .select("target_id")
        .eq("target_type", "seller")
        .in("target_id", sellerIds);
      reviewedSellerIds = new Set((reviewed || []).map((r: any) => r.target_id));
    }
    const unreviewed_sellers = (pendingSellers || []).filter(
      (s: any) => !reviewedSellerIds.has(s.id)
    );

    // Fetch pending/draft products
    const { data: pendingProducts } = await db
      .from("products")
      .select("*")
      .in("approval_status", ["pending", "draft"])
      .limit(BATCH_PRODUCTS);

    const productIds = (pendingProducts || []).map((p: any) => p.id);
    let reviewedProductIds = new Set<string>();
    if (productIds.length > 0) {
      const { data: reviewed } = await db
        .from("ai_review_log")
        .select("target_id")
        .eq("target_type", "product")
        .in("target_id", productIds);
      reviewedProductIds = new Set((reviewed || []).map((r: any) => r.target_id));
    }
    const unreviewed_products = (pendingProducts || []).filter(
      (p: any) => !reviewedProductIds.has(p.id)
    );

    let processed = 0;
    let skipped = 0;

    // Process sellers
    for (const seller of unreviewed_sellers) {
      const ok = await processItem(db, "seller", seller, seller.society_id);
      if (ok) processed++;
      else skipped++;
    }

    // Process products
    for (const product of unreviewed_products) {
      let societyId = null;
      const { data: sellerData } = await db
        .from("seller_profiles")
        .select("society_id")
        .eq("id", product.seller_id)
        .single();
      if (sellerData) societyId = sellerData.society_id;

      const ok = await processItem(db, "product", product, societyId);
      if (ok) processed++;
      else skipped++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        skipped,
        sellers: unreviewed_sellers.length,
        products: unreviewed_products.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("ai-auto-review error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
