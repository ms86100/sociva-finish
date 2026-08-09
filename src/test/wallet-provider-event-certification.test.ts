import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from '../../supabase/functions/_shared/financial-runtime';
import { verifyRazorpaySignature } from '../../supabase/functions/_shared/razorpay-signature';

const secret = 'wallet-certification-webhook-secret';
const capturedEvent = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_wallet_certification',
        order_id: 'order_wallet_certification',
        amount: 12500,
        currency: 'INR',
        status: 'captured',
      },
    },
  },
});

const sign = (body: string) =>
  createHmac('sha256', secret).update(body).digest('hex');
const read = (path: string) =>
  readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Razorpay provider-event certification', () => {
  it('accepts the exact signed bytes and rejects body mutation', async () => {
    const signature = sign(capturedEvent);

    await expect(
      verifyRazorpaySignature(capturedEvent, signature, secret),
    ).resolves.toBe(true);
    await expect(
      verifyRazorpaySignature(`${capturedEvent} `, signature, secret),
    ).resolves.toBe(false);
  });

  it.each([
    '',
    'not-hex',
    '00',
    `${'a'.repeat(63)}z`,
    'a'.repeat(66),
  ])('rejects malformed signatures without throwing: %j', async (signature) => {
    await expect(
      verifyRazorpaySignature(capturedEvent, signature, secret),
    ).resolves.toBe(false);
  });

  it('verifies simultaneous duplicate deliveries deterministically', async () => {
    const signature = sign(capturedEvent);
    const results = await Promise.all(
      Array.from({ length: 64 }, () =>
        verifyRazorpaySignature(capturedEvent, signature, secret),
      ),
    );

    expect(results).toEqual(Array(64).fill(true));
  });

  it('fails closed when the database preflight RPC is absent', async () => {
    const check = await checkFinancialRuntime(
      {
        rpc: async () => ({
          data: null,
          error: { message: 'function financial_runtime_preflight() does not exist' },
        }),
      },
      'payment_ready',
    );

    expect(check).toMatchObject({
      ready: false,
      reason: 'financial_runtime_preflight_unavailable',
    });
    const response = financialRuntimeUnavailableResponse(check, {});
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it('requires the requested database capability explicitly', async () => {
    const unavailable = await checkFinancialRuntime(
      {
        rpc: async () => ({
          data: { payment_ready: true, payout_ready: false },
          error: null,
        }),
      },
      'payout_ready',
    );
    const available = await checkFinancialRuntime(
      {
        rpc: async () => ({
          data: { payment_ready: true },
          error: null,
        }),
      },
      'payment_ready',
    );

    expect(unavailable.reason).toBe('financial_runtime_payout_ready_unavailable');
    expect(available.ready).toBe(true);
  });

  it.each([
    ['payment_ready', 'payment_create_enabled'],
    ['payment_ready', 'payment_confirm_enabled'],
    ['payment_ready', 'webhook_capture_enabled'],
    ['refund_ready', 'webhook_refund_enabled'],
    ['refund_ready', 'refund_processing_enabled'],
    ['payout_ready', 'payout_processing_enabled'],
    ['recovery_ready', 'recovery_mutations_enabled'],
    ['reconciliation_ready', 'reconciliation_read_enabled'],
  ] as const)(
    'blocks ready-but-disabled %s / %s before mutation',
    async (capability, enablement) => {
      let providerOrMutationCalls = 0;
      const check = await checkFinancialRuntime(
        {
          rpc: async () => ({
            data: { [capability]: true, [enablement]: false },
            error: null,
          }),
        },
        capability,
        enablement,
      );
      if (check.ready) providerOrMutationCalls += 1;

      expect(check).toMatchObject({
        ready: false,
        reason: `financial_runtime_${enablement}_disabled`,
      });
      expect(providerOrMutationCalls).toBe(0);
      expect(financialRuntimeUnavailableResponse(check, {}).status).toBe(503);
    },
  );

  it('requires both payout and Route enablement before transfer work', async () => {
    const check = await checkFinancialRuntime(
      {
        rpc: async () => ({
          data: {
            payout_ready: true,
            payout_processing_enabled: true,
            route_transfer_enabled: false,
          },
          error: null,
        }),
      },
      'payout_ready',
      ['payout_processing_enabled', 'route_transfer_enabled'],
    );

    expect(check).toMatchObject({
      ready: false,
      reason: 'financial_runtime_route_transfer_enabled_disabled',
    });
  });

  it.each([
    ['create-razorpay-order', 'payment_create_enabled'],
    ['confirm-razorpay-payment', 'payment_confirm_enabled'],
    ['refund-processor', 'refund_processing_enabled'],
    ['process-settlements', 'payout_processing_enabled'],
    ['process-settlements', 'route_transfer_enabled'],
    ['recover-financial-operations', 'recovery_mutations_enabled'],
    ['reconcile-financials', 'reconciliation_read_enabled'],
    ['razorpay-webhook', 'webhook_capture_enabled'],
    ['razorpay-webhook', 'webhook_refund_enabled'],
  ])('%s requires the explicit %s gate', (functionName, enablement) => {
    const source = read(`supabase/functions/${functionName}/index.ts`);
    expect(source).toContain(enablement);
  });

  it('defines every new capability gate as default false', () => {
    const migration = read(
      'supabase/migrations/20260808145300_financial_capability_enablement_gates.sql',
    );
    for (const gate of [
      'provider_payment_create_enabled',
      'provider_payment_confirm_enabled',
      'provider_webhook_capture_enabled',
      'provider_webhook_refund_enabled',
      'provider_refund_processing_enabled',
      'financial_recovery_mutations_enabled',
      'reconciliation_read_enabled',
    ]) {
      expect(migration).toMatch(
        new RegExp(`'${gate}'\\s*,\\s*false`, 'm'),
      );
    }
  });

  it('rejects malformed webhook JSON before database preflight', () => {
    const source = read('supabase/functions/razorpay-webhook/index.ts');
    const parsePosition = source.indexOf('payload = JSON.parse(body)');
    const badRequestPosition = source.indexOf("status: 400");
    const preflightPosition = source.indexOf(
      'const runtime = await checkFinancialRuntime',
    );

    expect(parsePosition).toBeGreaterThan(-1);
    expect(badRequestPosition).toBeGreaterThan(parsePosition);
    expect(preflightPosition).toBeGreaterThan(badRequestPosition);
    expect(source).toContain("error: 'Malformed JSON payload'");
  });

  it.each([
    [
      'create-razorpay-order',
      'const runtime = await checkFinancialRuntime',
      "fetch('https://api.razorpay.com/v1/orders'",
    ],
    [
      'confirm-razorpay-payment',
      'const runtime = await checkFinancialRuntime',
      'const creds = await getRazorpayCredentials',
    ],
    [
      'refund-processor',
      'const runtime = await checkFinancialRuntime',
      'const gw = await callRazorpayRefund',
    ],
    [
      'process-settlements',
      'const runtime = await checkFinancialRuntime',
      'const transfer = await createRouteTransfer',
    ],
    [
      'recover-financial-operations',
      'const runtime = await checkFinancialRuntime',
      'const credentials = await getRazorpayCredentials',
    ],
    [
      'reconcile-financials',
      'const runtime = await checkFinancialRuntime',
      'const credentials = await getRazorpayCredentials',
    ],
    [
      'razorpay-webhook',
      'const runtime = await checkFinancialRuntime',
      "eventStore = supabase",
    ],
  ])(
    '%s checks database readiness before financial/provider work',
    (functionName, gate, financialWork) => {
      const source = read(`supabase/functions/${functionName}/index.ts`);
      expect(source.indexOf(gate)).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(financialWork)).toBeGreaterThan(source.indexOf(gate));
    },
  );
});
