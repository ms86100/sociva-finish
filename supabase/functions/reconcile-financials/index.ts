import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { getRazorpayCredentials } from "../_shared/credentials.ts";
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from "../_shared/financial-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchRazorpayRows(opts: {
  keyId: string;
  keySecret: string;
  resource: "payments" | "refunds" | "transfers" | "settlements";
  from: number;
  to: number;
}): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const authorization = `Basic ${btoa(`${opts.keyId}:${opts.keySecret}`)}`;
  for (let skip = 0; skip < 10_000; skip += 100) {
    const url = new URL(`https://api.razorpay.com/v1/${opts.resource}`);
    url.searchParams.set("from", String(opts.from));
    url.searchParams.set("to", String(opts.to));
    url.searchParams.set("count", "100");
    url.searchParams.set("skip", String(skip));
    const response = await fetch(url, {
      headers: { Authorization: authorization },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `razorpay_${opts.resource}_fetch_failed:${response.status}:${
          body?.error?.description || body?.error?.reason || "unknown"
        }`,
      );
    }
    const items = Array.isArray(body?.items) ? body.items : [];
    rows.push(...items);
    if (items.length < 100) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
  );
  const runtime = await checkFinancialRuntime(
    supabase,
    "reconciliation_ready",
    "reconciliation_read_enabled",
  );
  if (!runtime.ready) {
    return financialRuntimeUnavailableResponse(runtime, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = req.headers.get("x-cron-secret") || "";
  const isService = authHeader === `Bearer ${serviceRoleKey}`;
  const isCron = !!cronSecret && cronSecret === Deno.env.get("CRON_SECRET");
  if (!isService && !isCron) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    // Default to today in IST so the date label matches Razorpay's settlement calendar.
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const reconciliationDate =
      typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : istNow.toISOString().slice(0, 10);
    // Use IST (UTC+05:30) midnight so Razorpay's settlement windows align with
    // Indian business dates rather than UTC dates.
    const from = Math.floor(
      new Date(`${reconciliationDate}T00:00:00+05:30`).getTime() / 1000,
    );
    const to = from + 86_399;

    const credentials = await getRazorpayCredentials(supabase);
    if (!credentials.keyId || !credentials.keySecret) {
      throw new Error("razorpay_credentials_required_for_external_reconciliation");
    }

    const resourceTypes = [
      ["payments", "payment"],
      ["refunds", "refund"],
      ["transfers", "transfer"],
      ["settlements", "settlement"],
    ] as const;
    let importedRows = 0;
    for (const [resource, eventType] of resourceTypes) {
      const providerRows = await fetchRazorpayRows({
        keyId: credentials.keyId,
        keySecret: credentials.keySecret,
        resource,
        from,
        to,
      });
      const rows = await Promise.all(providerRows.map(async (row: any) => {
        const canonical = JSON.stringify(row);
        return {
          provider: eventType === "transfer" ? "razorpay_route" : "razorpay",
          event_type: eventType,
          external_reference: String(row.id),
          parent_reference: row.payment_id || row.order_id || row.utr || null,
          amount_minor: Number(row.amount || 0),
          fee_minor: Number(row.fee || 0),
          tax_minor: Number(row.tax || 0),
          currency: String(row.currency || "INR").toUpperCase(),
          provider_status: String(row.status || "unknown"),
          occurred_at: new Date(Number(row.created_at || from) * 1000).toISOString(),
          settled_at: row.settled_at
            ? new Date(Number(row.settled_at) * 1000).toISOString()
            : null,
          raw_payload: row,
          payload_fingerprint: await sha256Hex(canonical),
        };
      }));
      if (rows.length > 0) {
        const { error: importError } = await supabase
          .from("provider_statement_rows")
          .upsert(rows, {
            onConflict: "provider,event_type,external_reference",
            ignoreDuplicates: false,
          });
        if (importError) {
          throw new Error(`provider_statement_import_failed:${importError.message}`);
        }
      }
      importedRows += rows.length;
    }

    const { data, error } = await supabase.rpc(
      "run_financial_reconciliation",
      { p_reconciliation_date: reconciliationDate },
    );
    if (error) throw error;
    const { data: externalData, error: externalError } = await supabase.rpc(
      "reconcile_external_statements",
      { p_reconciliation_date: reconciliationDate },
    );
    if (externalError) throw externalError;

    const { count: openCount, error: countError } = await supabase
      .from("financial_reconciliation_records")
      .select("id", { count: "exact", head: true })
      .eq("reconciliation_date", reconciliationDate)
      .in("status", ["open", "investigating"]);
    if (countError) throw countError;

    return new Response(
      JSON.stringify({
        ok: true,
        reconciliation_date: reconciliationDate,
        imported_provider_rows: importedRows,
        open_exceptions: openCount || 0,
        result: data,
        external_result: externalData,
      }),
      {
        status: openCount && openCount > 0 ? 409 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[reconcile-financials]", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
