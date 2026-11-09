import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('Evolution Go VPS independence contracts (static)', () => {
  const compose = read('infrastructure/evolution-go/docker-compose.yml');
  const relayCompose = read('infrastructure/evolution-go/docker-compose.relay.yml');
  const envExample = read('infrastructure/evolution-go/.env.example');
  const evoClient = read('supabase/functions/_shared/evolution-go.ts');
  const evoAdmin = read('supabase/functions/evolution-go-admin/index.ts');
  const webhook = read('supabase/functions/receive-evolution-go-webhook/index.ts');
  const ui = read('src/components/admin/communication/AdminCommunicationCentre.tsx');
  const nav = read('src/components/admin/AdminSidebarNav.tsx');
  const guide = read('docs/evolution-go-staging-execution-guide.md');

  it('compose is permanent and binds Evolution to localhost for TLS front', () => {
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('evolution_go_pg_data');
    expect(compose).toContain('evolution_go_data');
    expect(compose).toContain('CONNECT_ON_STARTUP');
    expect(compose).toContain('127.0.0.1');
    expect(compose).toContain('healthcheck:');
  });

  it('webhook relay is private (no public ports) and injects header via Caddyfile', () => {
    expect(relayCompose).toContain('webhook-relay');
    expect(relayCompose).not.toMatch(/^\s*ports:/m);
    expect(relayCompose).toContain('evolution_internal');
    const caddy = read('infrastructure/evolution-go/Caddyfile.webhook-relay');
    expect(caddy).toContain('x-sociva-webhook-secret');
    expect(caddy).toContain('remote_ip');
    expect(caddy).toContain('receive-evolution-go-webhook');
  });

  it('env example enables reconnect and does not document query webhook secrets', () => {
    expect(envExample).toContain('CONNECT_ON_STARTUP=true');
    expect(envExample).not.toContain('receive-evolution-go-webhook?secret=');
    expect(envExample).toContain('EVOLUTION_GO_WEBHOOK_URL');
  });

  it('admin can override webhook URL for private relay without query secrets', () => {
    expect(evoAdmin).toContain('EVOLUTION_GO_WEBHOOK_URL');
    expect(evoAdmin).toContain('invalid_webhook_url');
    expect(evoAdmin).toContain('private Docker relay');
  });

  it('client uses OpenAPI-style paths and requires https except localhost', () => {
    expect(evoClient).toContain('/instance/create');
    expect(evoClient).toContain('/instance/qr');
    expect(evoClient).toContain('/send/text');
    expect(evoClient).toContain('must be https in production');
  });

  it('webhook rejects query secrets and untrusted instances', () => {
    expect(webhook).toContain('query_secret_rejected');
    expect(webhook).toContain('no_trusted_instance');
    expect(webhook).toContain('unknown_instance');
  });

  it('Admin Communication Centre exposes QR connect/refresh/verify', () => {
    expect(nav).toContain('communication-centre');
    expect(ui).toContain('Connect WhatsApp');
    expect(ui).toContain('Refresh QR');
    expect(ui).toContain('Verify status');
    expect(ui).toContain('qrBase64');
  });

  it('execution guide separates Windows independence from QR pairing', () => {
    expect(guide).toContain('STEP 10 - Windows independence');
    expect(guide).toContain('STEP 11 - Docker restart and VPS reboot');
    expect(guide).toContain('QR pairing ≠ keeping VPS running');
    expect(guide).toContain('Communication Centre');
  });
});
