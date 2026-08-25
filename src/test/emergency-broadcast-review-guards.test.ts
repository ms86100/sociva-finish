import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('emergency broadcast + review prompt guards', () => {
  it('admin broadcast uses security-definer RPC (not self-only queue RLS)', () => {
    const sheet = readFileSync(
      resolve(__dirname, '../components/admin/EmergencyBroadcastSheet.tsx'),
      'utf8',
    );
    expect(sheet).toMatch(/admin_send_emergency_broadcast/);
    expect(sheet).toMatch(/Select a society first/);
    expect(sheet).not.toMatch(/notifySocietyMembers\(/);
  });

  it('migration blocks review prompts for unfinished checkouts', () => {
    const mig = readFileSync(
      resolve(
        __dirname,
        '../../supabase/migrations/20260825172000_admin_emergency_broadcast_and_review_guards.sql',
      ),
      'utf8',
    );
    expect(mig).toMatch(/admin_send_emergency_broadcast/);
    expect(mig).toMatch(/admin_notify_society_members/);
    expect(mig).toMatch(/payment_pending/);
    expect(mig).toMatch(/o\.status::text IN \('delivered', 'completed', 'buyer_received', 'picked_up'\)/);
  });
});
