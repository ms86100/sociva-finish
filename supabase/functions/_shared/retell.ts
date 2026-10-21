const RETELL_CREATE_WEB_CALL_URL = "https://api.retellai.com/v3/create-web-call";

function sanitizeCredential(value: string | undefined | null): string {
  return String(value || "").trim();
}

async function readRetellCredential(supabase: any, dbKey: string, envKey: string): Promise<string | undefined> {
  const fromEnv = sanitizeCredential(Deno.env.get(envKey));
  if (fromEnv) return fromEnv;
  try {
    const { data, error } = await supabase.rpc("get_edge_credential", { p_key: dbKey });
    if (!error && typeof data === "string") {
      const stored = sanitizeCredential(data);
      if (stored) return stored;
    }
  } catch (err) {
    console.warn(`[retell] get_edge_credential failed for ${dbKey}`, (err as Error)?.message || err);
  }
  return undefined;
}

export async function getRetellApiKey(supabase: any): Promise<string | undefined> {
  return readRetellCredential(supabase, "retell_api_key", "RETELL_API_KEY");
}

export async function getRetellAgentId(supabase: any): Promise<string | undefined> {
  return readRetellCredential(supabase, "retell_agent_id", "RETELL_AGENT_ID");
}

export type RetellWebCallJoin = {
  call_id: string;
  access_token: string;
  transport?: string;
  ice_servers?: unknown[];
};

export async function createRetellWebCall(opts: {
  apiKey: string;
  agentId: string;
  leadId: string;
  sellerName: string;
  sellerPhone: string;
  societyName: string;
}): Promise<RetellWebCallJoin> {
  const response = await fetch(RETELL_CREATE_WEB_CALL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: opts.agentId,
      retell_llm_dynamic_variables: {
        seller_name: opts.sellerName,
        seller_phone: opts.sellerPhone,
        society_name: opts.societyName,
        call_type: "seller_success",
      },
      metadata: {
        lead_id: opts.leadId,
        source: "sociva_web",
      },
    }),
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Retell create-web-call failed (${response.status})`;
    throw new Error(message);
  }

  const callId = payload?.call_id;
  const accessToken = payload?.access_token;
  if (!callId || !accessToken) {
    throw new Error("Retell did not return a call token");
  }

  return {
    call_id: String(callId),
    access_token: String(accessToken),
    transport: payload?.transport ? String(payload.transport) : undefined,
    ice_servers: Array.isArray(payload?.ice_servers) ? payload.ice_servers : undefined,
  };
}

export async function getRetellCall(opts: {
  apiKey: string;
  callId: string;
}): Promise<any> {
  const encoded = encodeURIComponent(opts.callId);
  const urls = [
    `https://api.retellai.com/v2/get-call/${encoded}`,
    `https://api.retellai.com/v3/get-call/${encoded}`,
  ];

  let lastStatus = 0;
  let lastBody = "";
  for (const url of urls) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
    lastStatus = response.status;
    lastBody = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(lastBody);
      } catch {
        throw new Error("Retell returned an unreadable call record");
      }
    }
    if (response.status !== 404) break;
  }

  const message = `Retell get-call failed (${lastStatus})`;
  throw new Error(message);
}

/** Keep admin payloads small and avoid shipping unused Retell fields. */
export function pickRetellCallForAdmin(call: any) {
  const analysis = call?.call_analysis || {};
  return {
    call_id: call?.call_id ?? null,
    call_status: call?.call_status ?? null,
    start_timestamp: call?.start_timestamp ?? null,
    end_timestamp: call?.end_timestamp ?? null,
    duration_ms: call?.duration_ms ?? null,
    disconnection_reason: call?.disconnection_reason ?? null,
    transcript: call?.transcript ?? null,
    recording_url: call?.recording_url ?? null,
    public_log_url: call?.public_log_url ?? null,
    call_summary: analysis.call_summary ?? analysis.summary ?? null,
    user_sentiment: analysis.user_sentiment ?? null,
    custom_analysis_data: analysis.custom_analysis_data ?? null,
  };
}
