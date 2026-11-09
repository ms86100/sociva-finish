import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('WhatsApp provider adapter + Evolution Go (source contracts)', () => {
  const migration = read('supabase/migrations/20261103140000_whatsapp_provider_evolution_go.sql');
  const rollback = read('supabase/rollbacks/20261103140000_whatsapp_provider_evolution_go.rollback.sql');
  const provider = read('supabase/functions/_shared/whatsapp-provider.ts');
  const notify = read('supabase/functions/_shared/whatsapp-notify.ts');
  const pnq = read('supabase/functions/process-notification-queue/index.ts');
  const evoAdmin = read('supabase/functions/evolution-go-admin/index.ts');
  const evoWebhook = read('supabase/functions/receive-evolution-go-webhook/index.ts');
  const metaWa = read('supabase/functions/_shared/whatsapp.ts');
  const metaSend = read('supabase/functions/send-whatsapp/index.ts');
  const ui = read('src/components/admin/communication/AdminCommunicationCentre.tsx');
  const nav = read('src/components/admin/AdminSidebarNav.tsx');
  const compose = read('infrastructure/evolution-go/docker-compose.yml');

  it('keeps Meta as default provider and does not dual-send', () => {
    expect(migration).toContain("DEFAULT 'meta'");
    expect(migration).toContain("active_provider IN ('meta', 'evolution_go')");
    expect(provider).toContain('Never silently falls through to the inactive provider');
    expect(provider).toContain("active_provider: \"meta\"");
    expect(notify).toContain('sendViaActiveWhatsAppProvider');
    expect(notify).not.toContain('sendWhatsAppTemplateOrText({');
  });

  it('blocks evolution live without readiness gates and supports kill switch', () => {
    expect(migration).toContain('evolution_go live blocked');
    expect(migration).toContain('admin_rollback_whatsapp_provider_to_meta');
    expect(migration).toContain('readiness_admin_approved');
    expect(migration).toContain('retry_cross_provider');
    expect(evoAdmin).toContain('kill_switch_meta');
    expect(ui).toContain('Kill switch to Meta');
  });

  it('extends whatsapp_messages with provider stamp and dry_run', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS provider');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS dry_run');
    expect(migration).toContain('notification_queue_id');
    expect(provider).toContain('logProviderWhatsAppMessage');
    expect(provider).toContain('delivery_confirmed: false');
  });

  it('preserves Meta Cloud API modules unchanged as callable path', () => {
    expect(metaWa).toContain('graph.facebook.com');
    expect(metaWa).toContain('sendWhatsAppTemplateOrText');
    expect(metaSend).toContain('send-whatsapp');
    expect(metaSend).toContain('requireAdmin');
  });

  it('reuses notification_queue / PNQ and stamps delivery_evidence', () => {
    expect(pnq).toContain('deliverWhatsAppForQueueItem');
    expect(pnq).toContain('delivery_evidence');
    expect(pnq).toContain('Single active provider only');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS public.communication_outbox');
  });

  it('hardens Evolution webhook auth, dedupe, rate limit, no order mutations', () => {
    expect(evoWebhook).toContain('timingSafeEqual');
    expect(evoWebhook).toContain('rateLimit');
    expect(evoWebhook).toContain('replay_rejected');
    expect(evoWebhook).toContain('event_dedupe_key');
    expect(evoWebhook).toContain('unknown_instance');
    expect(evoWebhook).toContain('no order accept/reject/cancel');
    expect(evoWebhook).not.toContain('update.*orders');
    expect(evoWebhook).not.toContain('.from("orders")');
  });

  it('ships Docker compose for persistent VPS deployment', () => {
    expect(compose).toContain('evoapicloud/evolution-go');
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('evolution_go_pg_data');
    expect(compose).toContain('CONNECT_ON_STARTUP');
  });

  it('exposes Communication Centre in admin navigation', () => {
    expect(nav).toContain('communication-centre');
    expect(ui).toContain('Approve live Evolution Go');
    expect(ui).toContain('Ops dashboard');
    expect(ui).toContain('HTTP accept only');
  });

  it('has a reversible rollback script', () => {
    expect(rollback).toContain('DROP TABLE IF EXISTS public.whatsapp_provider_config');
    expect(rollback).toContain('admin_rollback_whatsapp_provider_to_meta');
  });

  it('audits explicit cross-provider retries only', () => {
    expect(migration).toContain('admin_audit_whatsapp_cross_provider_retry');
    expect(evoAdmin).toContain('retry_failed_with_active_provider');
    expect(evoAdmin).toContain('WhatsApp-only retry');
    expect(evoAdmin).toContain('pushUntouched');
  });
});
