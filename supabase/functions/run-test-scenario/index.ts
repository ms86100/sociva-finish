import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TEST_ACTORS: Record<string, { email: string; password: string }> = {
  buyer: { email: "integration-buyer@test.sociva.com", password: "TestBuyer2026!" },
  seller: { email: "integration-seller@test.sociva.com", password: "TestSeller2026!" },
  admin: { email: "integration-admin@test.sociva.com", password: "TestAdmin2026!" },
  guard: { email: "integration-guard@test.sociva.com", password: "TestGuard2026!" },
};

interface TestStep {
  step_id: string;
  label: string;
  action: "insert" | "update" | "select" | "delete" | "rpc" | "assert" | "setup";
  table?: string;
  actor: string;
  params?: Record<string, any>;
  expect?: {
    status?: "success" | "error";
    row_count?: number;
    field_checks?: Record<string, any>;
  };
  on_fail?: "abort" | "continue" | "skip_remaining";
  cleanup?: boolean;
}

interface StepResult {
  step_id: string;
  label: string;
  outcome: "passed" | "failed" | "skipped";
  duration_ms: number;
  error_message?: string;
  suggested_fix?: string;
  response_data?: any;
}

// ─── Error-to-Fix Mapping ─────────────────────────────────────────────
function suggestFix(error: string, step: TestStep): string {
  const e = error.toLowerCase();
  if (e.includes("unique constraint") || e.includes("duplicate key")) {
    if (e.includes("cart_items")) return "UX Bug: Cart should upsert (increment qty) instead of rejecting. Add ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity, or handle in frontend.";
    return `Duplicate key on ${step.table}. Use upsert with ON CONFLICT or check for existing row before insert.`;
  }
  if (e.includes("violates row-level security") || e.includes("rls")) return `RLS policy blocking ${step.action} on ${step.table} for '${step.actor}'. Check pg_policies for this table.`;
  if (e.includes("violates foreign key")) return `Foreign key violation. The referenced parent row doesn't exist — ensure setup steps create all required records first.`;
  if (e.includes("invalid input value for enum")) { const m = error.match(/enum (\w+): "([^"]+)"/); return `Invalid enum "${m?.[2]}" for ${m?.[1]}. Check valid enum values in schema.`; }
  if (e.includes("permission denied")) return `Permission denied for ${step.actor} on ${step.table}. Check RLS policies and GRANTs.`;
  if (e.includes("auth failed") || e.includes("invalid login credentials")) return `Test user '${step.actor}' doesn't exist. The runner auto-creates users but may have hit a race condition. Try running again.`;
  if (e.includes("invalid transition") || e.includes("status transition")) return `Status transition blocked by validate_order_status_transition trigger. Check category_status_transitions for allowed paths.`;
  if (e.includes("expected error but operation succeeded")) return `⚠️ Security gap: Operation was expected to fail but succeeded. The guard/constraint/RLS is NOT blocking this — investigate!`;
  if (e.includes("rows, got")) return `Row count mismatch. Check for stale test data or overly broad/narrow query filters.`;
  if (e.includes("field") && e.includes("expected") && e.includes("got")) return `Field value mismatch. A trigger or default may be overriding the expected value.`;
  if (e.includes("null value") && e.includes("not-null")) { const m = error.match(/column "(\w+)"/); return `Required field '${m?.[1]}' is null. Add it to step params or set a DB default.`; }
  if (e.includes("not found") || e.includes("no rows")) return `No matching rows. Template variable {{...}} may not have resolved — check previous step outputs.`;
  return `Review: 1) Are template vars resolving? 2) Does ${step.actor} have permission on ${step.table}? 3) Are all required fields set?`;
}

// ─── Template Resolution ──────────────────────────────────────────────
// Resolves {{step_id.field}} or {{step_id.field.nested}} references
function resolveTemplates(obj: any, context: Record<string, any>): any {
  if (typeof obj === "string") {
    // Full-string replacement (preserves type — e.g. keeps UUID as string, number as number)
    const fullMatch = obj.match(/^\{\{([^}]+)\}\}$/);
    if (fullMatch) {
      return resolvePath(fullMatch[1], context);
    }
    // Inline replacement (always returns string)
    return obj.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const val = resolvePath(path, context);
      return val !== undefined ? String(val) : `{{${path}}}`;
    });
  }
  if (Array.isArray(obj)) return obj.map(item => resolveTemplates(item, context));
  if (obj && typeof obj === "object") {
    const resolved: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveTemplates(v, context);
    }
    return resolved;
  }
  return obj;
}

function resolvePath(path: string, context: Record<string, any>): any {
  const parts = path.trim().split(".");
  let current: any = context;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  // Auth check — only admins
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
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { scenario_id } = await req.json();
    if (!scenario_id) {
      return new Response(JSON.stringify({ error: "scenario_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: scenario, error: fetchErr } = await adminClient
      .from("test_scenarios")
      .select("*")
      .eq("id", scenario_id)
      .single();

    if (fetchErr || !scenario) {
      return new Response(JSON.stringify({ error: "Scenario not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const steps: TestStep[] = Array.isArray(scenario.steps) ? scenario.steps : [];
    const runId = crypto.randomUUID();
    const results: StepResult[] = [];
    const cleanupIds: { table: string; ids: string[] }[] = [];
    const context: Record<string, any> = {}; // step_id -> response_data

    // Auto-seed test users if they don't exist
    async function ensureTestUser(actor: string, creds: { email: string; password: string }) {
      const { data: listed, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw new Error(`Failed to list users for ${actor}: ${listErr.message}`);

      let userId = listed?.users?.find((u: any) => u.email === creds.email)?.id as string | undefined;

      if (userId) {
        const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
          password: creds.password,
          email_confirm: true,
        });
        if (updateErr) throw new Error(`Failed to refresh test user ${actor}: ${updateErr.message}`);
      } else {
        const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
          email: creds.email,
          password: creds.password,
          email_confirm: true,
        });
        if (authErr) throw new Error(`Failed to create test user ${actor}: ${authErr.message}`);
        userId = authData.user!.id;
      }

      // Get or create test society
      let societyId: string;
      const { data: existingSociety } = await adminClient
        .from("societies")
        .select("id")
        .eq("name", "Integration Test Society")
        .single();

      if (existingSociety) {
        societyId = existingSociety.id;
      } else {
        const { data: newSociety, error: socErr } = await adminClient
          .from("societies")
          .insert({
            name: "Integration Test Society",
            slug: "integration-test-society",
            address: "123 Test Lane, Bangalore",
            latitude: 13.035,
            longitude: 77.65,
            is_active: true,
            security_mode: "basic",
          })
          .select("id")
          .single();
        if (socErr) throw socErr;
        societyId = newSociety!.id;
      }

      await adminClient.from("profiles").upsert({
        id: userId,
        name: `Integration ${actor.charAt(0).toUpperCase() + actor.slice(1)}`,
        email: creds.email,
        flat_number: actor === "buyer" ? "B-204" : actor === "seller" ? "S-101" : "A-001",
        block: "Tower A",
        society_id: societyId,
        verification_status: "approved",
        phone: `98765432${Object.keys(TEST_ACTORS).indexOf(actor) + 1}`,
      }, { onConflict: "id" });

      if (actor === "admin") {
        await adminClient.from("user_roles").upsert(
          { user_id: userId, role: "admin" },
          { onConflict: "user_id,role" }
        );
      }

      return userId;
    }

    // Auth clients cache
    const actorClients: Record<string, any> = {};
    async function getActorClient(actor: string) {
      if (actor === "service_role") return adminClient;
      if (actorClients[actor]) return actorClients[actor];
      const creds = TEST_ACTORS[actor];
      if (!creds) throw new Error(`Unknown actor: ${actor}`);

      // Ensure user exists before trying to sign in
      await ensureTestUser(actor, creds);

      const client = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { error } = await client.auth.signInWithPassword(creds);
      if (error) throw new Error(`Auth failed for ${actor}: ${error.message}`);
      actorClients[actor] = client;
      return client;
    }

    // Store actor user IDs in context for template access
    for (const [actor, creds] of Object.entries(TEST_ACTORS)) {
      try {
        const client = await getActorClient(actor);
        const { data: { user } } = await client.auth.getUser();
        if (user) context[`${actor}_user`] = { id: user.id, email: user.email };
      } catch (e) { console.error(`Actor ${actor} init failed:`, e.message); }
    }

    await adminClient
      .from("test_scenarios")
      .update({ last_result: "running", last_run_at: new Date().toISOString(), last_run_id: runId })
      .eq("id", scenario_id);

    let skipRemaining = false;

    for (const step of steps) {
      if (skipRemaining) {
        results.push({ step_id: step.step_id, label: step.label, outcome: "skipped", duration_ms: 0 });
        continue;
      }

      const start = performance.now();
      try {
        // Resolve templates in params and expect using context
        const resolvedParams = step.params ? resolveTemplates(step.params, context) : undefined;
        const resolvedExpect = step.expect ? resolveTemplates(step.expect, context) : undefined;

        const client = await getActorClient(step.actor);
        let data: any = null;
        let error: any = null;

        switch (step.action) {
          case "setup":
          case "insert": {
            const row = resolvedParams?.row || resolvedParams;
            const res = await client.from(step.table).insert(row).select().single();
            data = res.data; error = res.error;
            if (data?.id && step.cleanup !== false) {
              const existing = cleanupIds.find(c => c.table === step.table);
              if (existing) existing.ids.push(data.id);
              else cleanupIds.push({ table: step.table!, ids: [data.id] });
            }
            break;
          }
          case "select": {
            let q = client.from(step.table).select(resolvedParams?.columns || "*");
            if (resolvedParams?.filters) {
              for (const [col, val] of Object.entries(resolvedParams.filters)) {
                q = q.eq(col, val);
              }
            }
            if (resolvedParams?.limit) q = q.limit(resolvedParams.limit);
            if (resolvedParams?.single) {
              const res = await q.single();
              data = res.data; error = res.error;
            } else {
              const res = await q;
              data = res.data; error = res.error;
            }
            break;
          }
          case "update": {
            let q = client.from(step.table).update(resolvedParams?.set || {});
            if (resolvedParams?.match) {
              for (const [col, val] of Object.entries(resolvedParams.match)) {
                q = q.eq(col, val);
              }
            }
            const res = await q.select();
            data = res.data; error = res.error;
            if (Array.isArray(data) && data.length === 1) data = data[0];
            break;
          }
          case "delete": {
            let q = client.from(step.table).delete();
            if (resolvedParams?.match) {
              for (const [col, val] of Object.entries(resolvedParams.match)) {
                q = q.eq(col, val);
              }
            }
            const res = await q.select();
            data = res.data; error = res.error;
            break;
          }
          case "rpc": {
            const res = await client.rpc(resolvedParams?.function_name, resolvedParams?.args || {});
            data = res.data;
            error = res.error;
            if (!error && data && typeof data === "object" && data.success === false) {
              error = { message: data.error || `RPC ${resolvedParams?.function_name} returned success=false` };
            }
            break;
          }
          case "assert": {
            const prevResult = results[results.length - 1];
            if (resolvedExpect?.status === "error" && prevResult?.outcome === "failed") {
              data = { assertion: "expected_error_confirmed" };
            } else if (resolvedExpect?.status === "success" && prevResult?.outcome === "passed") {
              data = { assertion: "expected_success_confirmed" };
            } else {
              error = { message: `Assertion failed: expected ${resolvedExpect?.status}, got ${prevResult?.outcome}` };
            }
            break;
          }
        }

        // Validate expectations
        const expectStatus = resolvedExpect?.status || "success";
        if (expectStatus === "success" && error) {
          throw new Error(error.message || JSON.stringify(error));
        }
        if (expectStatus === "error" && !error) {
          throw new Error("Expected error but operation succeeded");
        }
        if (resolvedExpect?.row_count !== undefined && Array.isArray(data) && data.length !== resolvedExpect.row_count) {
          throw new Error(`Expected ${resolvedExpect.row_count} rows, got ${data.length}`);
        }
        if (resolvedExpect?.field_checks && data) {
          const target = Array.isArray(data) ? data[0] : data;
          for (const [field, expected] of Object.entries(resolvedExpect.field_checks)) {
            if (target?.[field] !== expected) {
              throw new Error(`Field ${field}: expected ${expected}, got ${target?.[field]}`);
            }
          }
        }

        // Store in context for later template resolution
        context[step.step_id] = data;

        results.push({
          step_id: step.step_id, label: step.label, outcome: "passed",
          duration_ms: Math.round(performance.now() - start),
          response_data: data,
        });
      } catch (err) {
        const fix = suggestFix(err.message, step);
        results.push({
          step_id: step.step_id, label: step.label, outcome: "failed",
          duration_ms: Math.round(performance.now() - start),
          error_message: err.message,
          suggested_fix: fix,
        });
        if (step.on_fail === "abort") break;
        if (step.on_fail === "skip_remaining") skipRemaining = true;
      }
    }

    // Cleanup test data (reverse order)
    for (const { table, ids } of cleanupIds.reverse()) {
      await adminClient.from(table).delete().in("id", ids);
    }

    // Save results
    const testResultRows = results.map(r => ({
      run_id: runId,
      module_name: scenario.module,
      test_name: `${scenario.name} > ${r.label}`,
      outcome: r.outcome,
      duration_ms: r.duration_ms,
      error_message: r.error_message || null,
      response_payload: r.response_data ? JSON.stringify(r.response_data).slice(0, 5000) : null,
      executed_at: new Date().toISOString(),
    }));

    if (testResultRows.length > 0) {
      await adminClient.from("test_results").insert(testResultRows);
    }

    const allPassed = results.every(r => r.outcome === "passed");
    const hasFailed = results.some(r => r.outcome === "failed");
    const finalResult = hasFailed ? "failed" : allPassed ? "passed" : "partial";

    await adminClient
      .from("test_scenarios")
      .update({ last_result: finalResult, last_run_at: new Date().toISOString(), last_run_id: runId })
      .eq("id", scenario_id);

    return new Response(
      JSON.stringify({ run_id: runId, result: finalResult, steps: results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Run error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
