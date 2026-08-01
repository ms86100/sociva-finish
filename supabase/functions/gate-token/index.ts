import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// AES-GCM encryption for token payloads (no PII in QR)
async function encryptPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(secret.padEnd(32, '0').substring(0, 32)),
    { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, keyMaterial, encoder.encode(payload)
  );
  // Format: base64(iv):base64(ciphertext)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return `${ivB64}:${ctB64}`;
}

async function decryptPayload(token: string, secret: string): Promise<string | null> {
  try {
    const [ivB64, ctB64] = token.split(':');
    if (!ivB64 || !ctB64) return null;
    const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
    const ct = new Uint8Array(atob(ctB64).split('').map(c => c.charCodeAt(0)));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", encoder.encode(secret.padEnd(32, '0').substring(0, 32)),
      { name: "AES-GCM" }, false, ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv }, keyMaterial, ct
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// HMAC signature for integrity
async function signToken(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// C5: Timing-safe signature comparison to prevent timing attacks
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await signToken(payload, secret);
  if (expected.length !== signature.length) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = claimsData.claims.sub;
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'generate';

    // Rate limit: 30 requests per minute per user
    const { allowed } = await checkRateLimit(`gate-token:${userId}`, 30, 60);
    if (!allowed) {
      return rateLimitResponse(corsHeaders);
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const signingSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.substring(0, 32);
    const encryptionSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.substring(32, 64) || signingSecret;

    if (action === 'generate') {
      // Get user profile - only fetch IDs, no PII in token
      const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('id, name, society_id, flat_number, block, verification_status, avatar_url')
        .eq('id', userId)
        .single();

      if (profileError || !profile || profile.verification_status !== 'approved') {
        return new Response(JSON.stringify({ error: 'Not a verified resident' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (!profile.society_id) {
        return new Response(JSON.stringify({ error: 'Not assigned to a society' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 60; // 60 seconds

      // Token payload contains ONLY IDs + timing — NO PII
      // Include nonce for deduplication
      const nonce = crypto.randomUUID();
      const payload = JSON.stringify({
        uid: profile.id,
        sid: profile.society_id,
        iat: now,
        exp: expiresAt,
        nonce,
      });

      // Encrypt the payload, then sign the encrypted blob
      const encrypted = await encryptPayload(payload, encryptionSecret);
      const signature = await signToken(encrypted, signingSecret);
      const gateToken = encrypted + '.' + signature;

      return new Response(JSON.stringify({
        token: gateToken,
        expires_at: expiresAt,
        resident: {
          name: profile.name,
          flat_number: profile.flat_number,
          block: profile.block,
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (action === 'validate') {
      const body = await req.json();
      const gateToken = body.token;

      if (!gateToken || !gateToken.includes('.')) {
        return new Response(JSON.stringify({ valid: false, error: 'Invalid token format' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Split: everything before last '.' is encrypted payload, after is signature
      const lastDot = gateToken.lastIndexOf('.');
      const encryptedPayload = gateToken.substring(0, lastDot);
      const signature = gateToken.substring(lastDot + 1);

      // Verify signature first
      const isValidSig = await verifySignature(encryptedPayload, signature, signingSecret);
      if (!isValidSig) {
        // Log failed validation attempt
        await serviceClient.from('audit_log').insert({
          actor_id: userId,
          action: 'gate_token_invalid_signature',
          target_type: 'gate_token',
          metadata: { reason: 'signature_mismatch' },
        }).then(() => {}, () => {});
        return new Response(JSON.stringify({ valid: false, error: 'Invalid signature' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Decrypt payload
      const decrypted = await decryptPayload(encryptedPayload, encryptionSecret);
      if (!decrypted) {
        await serviceClient.from('audit_log').insert({
          actor_id: userId,
          action: 'gate_token_decryption_failed',
          target_type: 'gate_token',
          metadata: { reason: 'corrupted_payload' },
        }).then(() => {}, () => {});
        return new Response(JSON.stringify({ valid: false, error: 'Corrupted token' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let payload: any;
      try {
        payload = JSON.parse(decrypted);
      } catch {
        return new Response(JSON.stringify({ valid: false, error: 'Corrupted token' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        await serviceClient.from('audit_log').insert({
          actor_id: userId,
          action: 'gate_token_expired',
          target_type: 'gate_token',
          target_id: payload.uid,
          society_id: payload.sid,
          metadata: { expired_at: payload.exp, checked_at: now },
        }).then(() => {}, () => {});
        return new Response(JSON.stringify({ valid: false, error: 'Token expired', expired: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Deduplication: check if this nonce was already used
      if (payload.nonce) {
        const { data: existingEntry } = await serviceClient
          .from('gate_entries')
          .select('id')
          .eq('user_id', payload.uid)
          .eq('society_id', payload.sid)
          .eq('notes', `nonce:${payload.nonce}`)
          .maybeSingle();

        if (existingEntry) {
          await serviceClient.from('audit_log').insert({
            actor_id: userId,
            action: 'gate_token_replay_blocked',
            target_type: 'gate_token',
            target_id: payload.uid,
            society_id: payload.sid,
            metadata: { nonce: payload.nonce },
          }).then(() => {}, () => {});
          return new Response(JSON.stringify({ valid: false, error: 'Token already used' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // Verify security officer belongs to same society
      const { data: securityCheck } = await serviceClient
        .from('security_staff')
        .select('id')
        .eq('user_id', userId)
        .eq('society_id', payload.sid)
        .eq('is_active', true)
        .is('deactivated_at', null)
        .maybeSingle();

      const isOfficer = !!securityCheck;
      const { data: adminCheck } = await serviceClient.rpc('is_society_admin', { _user_id: userId, _society_id: payload.sid });
      
      if (!isOfficer && !adminCheck) {
        await serviceClient.from('audit_log').insert({
          actor_id: userId,
          action: 'gate_token_unauthorized_validator',
          target_type: 'gate_token',
          target_id: payload.uid,
          society_id: payload.sid,
          metadata: { reason: 'not_officer_or_admin' },
        }).then(() => {}, () => {});
        return new Response(JSON.stringify({ valid: false, error: 'Not authorized for this society' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Fetch resident details server-side (not from token)
      const { data: resident } = await serviceClient
        .from('profiles')
        .select('id, name, flat_number, block, avatar_url')
        .eq('id', payload.uid)
        .eq('society_id', payload.sid)
        .single();

      if (!resident) {
        return new Response(JSON.stringify({ valid: false, error: 'Resident not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Check society security mode
      const { data: societyData } = await serviceClient
        .from('societies')
        .select('security_mode, security_confirmation_timeout_seconds')
        .eq('id', payload.sid)
        .single();

      const securityMode = societyData?.security_mode || 'basic';
      const timeoutSeconds = societyData?.security_confirmation_timeout_seconds || 20;

      if (securityMode === 'confirmation') {
        // Insert pending gate entry, await resident confirmation
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();
        
        const { data: entry, error: entryError } = await serviceClient.from('gate_entries').insert({
          user_id: payload.uid,
          society_id: payload.sid,
          entry_type: 'qr_verified',
          verified_by: userId,
          flat_number: resident.flat_number,
          resident_name: resident.name,
          confirmation_status: 'pending',
          awaiting_confirmation: true,
          confirmation_expires_at: expiresAt,
          notes: payload.nonce ? `nonce:${payload.nonce}` : null,
        }).select('id').single();

        if (entryError) {
          // UNIQUE constraint on nonce catches race condition
          if (entryError.code === '23505' && payload.nonce) {
            return new Response(JSON.stringify({ valid: false, error: 'Token already used' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          console.error('Entry insert error:', entryError);
          return new Response(JSON.stringify({ valid: false, error: 'Failed to create entry' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Send push notification to resident
        await serviceClient.from('notification_queue').insert({
          user_id: payload.uid,
          title: '🔐 Confirm Your Entry',
          body: `Are you entering the gate now? Please confirm in the app within ${timeoutSeconds} seconds.`,
          type: 'gate_confirmation',
          reference_path: '/gate-entry',
        });

        return new Response(JSON.stringify({
          valid: true,
          awaiting_confirmation: true,
          entry_id: entry.id,
          timeout_seconds: timeoutSeconds,
          resident: {
            name: resident.name,
            flat_number: resident.flat_number,
            block: resident.block,
            avatar_url: resident.avatar_url,
            user_id: resident.id,
          },
          society_id: payload.sid,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } else {
        // Basic mode: immediate validation
        const { error: basicErr } = await serviceClient.from('gate_entries').insert({
          user_id: payload.uid,
          society_id: payload.sid,
          entry_type: 'qr_verified',
          verified_by: userId,
          flat_number: resident.flat_number,
          resident_name: resident.name,
          confirmation_status: 'not_required',
          notes: payload.nonce ? `nonce:${payload.nonce}` : null,
        });

        if (basicErr?.code === '23505' && payload.nonce) {
          return new Response(JSON.stringify({ valid: false, error: 'Token already used' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
          valid: true,
          awaiting_confirmation: false,
          resident: {
            name: resident.name,
            flat_number: resident.flat_number,
            block: resident.block,
            avatar_url: resident.avatar_url,
            user_id: resident.id,
          },
          society_id: payload.sid,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

    } else if (action === 'rate_check_manual') {
      // GA BLOCKER 3: Rate limit for manual entry — 20/min per user
      const { allowed: manualAllowed } = await checkRateLimit(`manual-entry:${userId}`, 20, 60);
      if (!manualAllowed) {
        return rateLimitResponse(corsHeaders);
      }
      return new Response(JSON.stringify({ allowed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    console.error('Gate token error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
