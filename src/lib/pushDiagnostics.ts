// @ts-nocheck
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

export interface DiagnosticResult {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * Run a full diagnostic check of the push notification chain.
 * Tests: platform → plugin load → permission → FCM (iOS) → DB tokens → edge fn.
 */
export async function runPushDiagnostics(userId?: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  const platform = Capacitor.getPlatform();

  // 1. Platform check
  const isNative = Capacitor.isNativePlatform();
  results.push({
    step: '1. Platform',
    ok: isNative,
    detail: isNative ? `Native (${platform})` : `Web — push not supported`,
  });
  if (!isNative) return results;

  // 2. PushNotifications plugin
  let PN: any = null;
  try {
    const mod = await import('@capacitor/push-notifications');
    PN = mod.PushNotifications;
    results.push({ step: '2. PushNotifications plugin', ok: true, detail: 'Loaded' });
  } catch (e) {
    results.push({ step: '2. PushNotifications plugin', ok: false, detail: String(e) });
    return results;
  }

  // 3. Permission status
  try {
    const perm = await PN.checkPermissions();
    const granted = perm.receive === 'granted';
    
    // Gather extra context for debugging
    let extraDetail = `receive: ${perm.receive}`;
    if (!granted) {
      // Check if this is a fresh install (prompt) or previously denied
      const isDenied = perm.receive === 'denied';
      extraDetail += ` | ${isDenied ? 'User previously denied — must enable in Settings' : 'OS prompt never shown or was suppressed'}`;
      
      try {
        const reqResult = await PN.requestPermissions();
        extraDetail += ` | requestPermissions() → ${reqResult.receive}`;
      } catch (reqErr: any) {
        extraDetail += ` | requestPermissions() threw: ${reqErr?.message ?? String(reqErr)}`;
      }
    }
    
    results.push({
      step: '3. Permission',
      ok: granted,
      detail: extraDetail,
    });
  } catch (e: any) {
    results.push({ step: '3. Permission', ok: false, detail: `checkPermissions() threw: ${e?.message ?? String(e)}` });
  }

  let runtimeFcmToken: string | null = null;

  // 4. FCM plugin (iOS only)
  if (platform === 'ios') {
    try {
      const { FCM } = await import('@capacitor-community/fcm');
      results.push({ step: '4. FCM plugin (iOS)', ok: true, detail: 'Loaded' });

      // 5. FCM.getToken()
      try {
        const result = await FCM.getToken();
        const tok = result.token;
        const valid = tok && tok.length > 20 && !/^[A-Fa-f0-9]{64}$/.test(tok);
        if (valid) runtimeFcmToken = tok;
        results.push({
          step: '5. FCM.getToken() (iOS)',
          ok: !!valid,
          detail: valid
            ? `Token: ${tok.substring(0, 20)}… (${tok.length} chars)`
            : `Invalid or APNs-like: ${tok?.substring(0, 20) ?? 'null'}`,
        });
      } catch (e) {
        results.push({ step: '5. FCM.getToken() (iOS)', ok: false, detail: String(e) });
      }
    } catch (e) {
      results.push({ step: '4. FCM plugin (iOS)', ok: false, detail: String(e) });
    }
  }

  // 6. device_tokens in DB
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('device_tokens')
        .select('id, token, platform, updated_at, apns_token')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      const count = data?.length ?? 0;
      results.push({
        step: '6. device_tokens in DB',
        ok: count > 0,
        detail: `${count} token(s) found${count > 0 ? ` — latest: ${data![0].platform}` : ''}`,
      });

      if (platform === 'ios') {
        const runtimeExists = Boolean(runtimeFcmToken);
        const match = runtimeFcmToken
          ? Boolean(data?.some((row) => row.token === runtimeFcmToken))
          : false;

        results.push({
          step: '6b. Runtime token matches DB (iOS)',
          ok: runtimeExists && match,
          detail: !runtimeExists
            ? 'Runtime FCM token missing in app memory (hasToken=false root cause)'
            : match
              ? 'Runtime FCM token is persisted for this user'
              : 'Runtime FCM token exists but is NOT persisted for this user',
        });

        // BUG #4 FIX: Validate APNs token presence for iOS (required for direct delivery)
        const iosTokensWithApns = data?.filter((row) => row.platform === 'ios' && (row as any).apns_token) ?? [];
        const totalIosTokens = data?.filter((row) => row.platform === 'ios') ?? [];
        results.push({
          step: '6c. APNs token in DB (iOS)',
          ok: iosTokensWithApns.length > 0,
          detail: totalIosTokens.length === 0
            ? 'No iOS tokens in DB'
            : iosTokensWithApns.length === totalIosTokens.length
              ? `All ${totalIosTokens.length} iOS token(s) have apns_token ✓`
              : `${iosTokensWithApns.length}/${totalIosTokens.length} iOS tokens have apns_token — direct APNs delivery will fail for the rest`,
        });
      }
    } catch (e) {
      results.push({ step: '6. device_tokens in DB', ok: false, detail: String(e) });
      if (platform === 'ios') {
        results.push({ step: '6b. Runtime token matches DB (iOS)', ok: false, detail: 'Skipped due to DB query failure' });
        results.push({ step: '6c. APNs token in DB (iOS)', ok: false, detail: 'Skipped due to DB query failure' });
      }
    }
  } else {
    results.push({ step: '6. device_tokens in DB', ok: false, detail: 'No userId provided — skipped' });
    if (platform === 'ios') {
      results.push({ step: '6b. Runtime token matches DB (iOS)', ok: false, detail: 'No userId provided — skipped' });
      results.push({ step: '6c. APNs token in DB (iOS)', ok: false, detail: 'No userId provided — skipped' });
    }
  }

  // 7. Edge function test — uses notification_queue (service-role not needed)
  if (userId) {
    if (platform === 'ios' && !runtimeFcmToken) {
      results.push({
        step: '7. Queued test notification',
        ok: false,
        detail: 'Skipped: runtime FCM token missing; fix token registration first',
      });
    } else {
      try {
        // First verify the table is accessible
        const { count, error: countErr } = await supabase
          .from('notification_queue')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        if (countErr) {
          results.push({
            step: '7. Queued test notification',
            ok: false,
            detail: `Table access error: ${countErr.message} (code: ${countErr.code}, hint: ${countErr.hint ?? 'none'})`,
          });
        } else {
          const { data: insertData, error } = await supabase.from('notification_queue').insert({
            user_id: userId,
            title: '🔔 Push Diagnostics',
            body: 'If you see this, push notifications are working!',
            payload: { type: 'diagnostic' },
            status: 'pending',
          }).select('id').single();

          if (error) {
            results.push({
              step: '7. Queued test notification',
              ok: false,
              detail: `Insert failed: ${error.message} (code: ${error.code}, hint: ${error.hint ?? 'none'}, details: ${error.details ?? 'none'})`,
            });
          } else {
            results.push({
              step: '7. Queued test notification',
              ok: true,
              detail: `Queued (id: ${insertData?.id?.substring(0, 8)}…) — existing queue items: ${count ?? '?'}`,
            });
          }
        }
      } catch (e: any) {
        const msg = e?.message ?? JSON.stringify(e);
        results.push({ step: '7. Queued test notification', ok: false, detail: `Exception: ${msg}` });
      }
    }
  } else {
    results.push({ step: '7. Queued test notification', ok: false, detail: 'No userId — skipped' });
  }

  return results;
}

/** Pretty-print diagnostics to console. */
export function printDiagnostics(results: DiagnosticResult[]): void {
  console.group('🔔 Push Notification Diagnostics');
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${r.step}: ${r.detail}`);
  }
  console.groupEnd();
}
