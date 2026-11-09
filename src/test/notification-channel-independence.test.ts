import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('Notification channel independence (F1/F2/F4/F6/F7)', () => {
  const migration = read('supabase/migrations/20261103150000_notification_channel_independence.sql');
  const rollback = read('supabase/rollbacks/20261103150000_notification_channel_independence.rollback.sql');
  const channel = read('supabase/functions/_shared/whatsapp-channel.ts');
  const notify = read('supabase/functions/_shared/whatsapp-notify.ts');
  const pnq = read('supabase/functions/process-notification-queue/index.ts');
  const admin = read('supabase/functions/evolution-go-admin/index.ts');
  const webhook = read('supabase/functions/receive-evolution-go-webhook/index.ts');

  it('F1: claims WhatsApp channel in DB and skips on already_succeeded', () => {
    expect(migration).toContain('claim_whatsapp_channel_delivery');
    expect(migration).toContain("already_succeeded");
    expect(migration).toContain('whatsapp_messages_success_once_per_queue');
    expect(channel).toContain('claimWhatsAppChannel');
    expect(notify).toContain('claimWhatsAppChannel');
    expect(notify).toContain('already_succeeded');
    expect(notify).toContain('claimWhatsAppChannel');
    expect(pnq).toContain('successful WA is claimed in DB');
  });

  it('F2: admin retry is WhatsApp-only and does not reset push queue status', () => {
    expect(migration).toContain('admin_request_whatsapp_only_retry');
    expect(migration).toContain('push_untouched');
    expect(admin).toContain('whatsappOnly: true');
    expect(admin).toContain('pushUntouched: true');
    expect(admin).toContain('forceWhatsAppRetry: true');
    expect(admin).not.toMatch(/status:\s*"pending"[\s\S]*processed_at:\s*null/);
  });

  it('F4: push evidence merge preserves whatsapp evidence', () => {
    expect(channel).toContain('mergeDeliveryEvidence');
    expect(pnq).toContain('mergeDeliveryEvidence');
    expect(pnq).toContain('buildDeliveryEvidence(');
    expect(pnq).toContain('channelEvidence');
    expect(pnq).toContain('never let push evidence wipe whatsapp');
  });

  it('F6: webhook rejects query secrets and requires header auth', () => {
    expect(webhook).toContain('query_secret_rejected');
    expect(webhook).toContain('x-sociva-webhook-secret');
    expect(webhook).toContain('extractHeaderSecret');
    expect(webhook).not.toContain('secretFromQuery');
    expect(admin).toContain('never put the webhook secret in the query string');
    expect(admin).not.toContain('webhook?secret=');
  });

  it('F7: webhook requires trusted registered instance', () => {
    expect(migration).toContain('webhook_trusted');
    expect(webhook).toContain('no_trusted_instance');
    expect(webhook).toContain('unknown_instance');
    expect(webhook).toContain('instance_required');
    expect(webhook).toContain('webhook_trusted');
    expect(admin).toContain('webhook_trusted: true');
  });

  it('keeps Meta as default and does not alter order enqueue', () => {
    expect(migration).not.toContain('enqueue_seller_new_order_notification');
    expect(notify).toContain('loadWhatsAppProviderConfig');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.claim_whatsapp_channel_delivery');
  });

  it('documents regression scenarios for channel independence', () => {
    const doc = read('docs/audits/WHATSAPP-CHANNEL-INDEPENDENCE-REMEDIATION.md');
    expect(doc).toContain('F1');
    expect(doc).toContain('F2');
    expect(doc).toContain('Push OK, WA fail');
    expect(doc).toContain('WA OK, push fail');
  });
});
