// @ts-nocheck
import { APP_ENV, SUPABASE_URL } from '@/integrations/supabase/client';

/**
 * Persistent strip so testers never mistake a staging TestFlight build for production.
 */
export function StagingBanner() {
  if (APP_ENV !== 'staging') return null;

  const host = SUPABASE_URL.replace(/^https?:\/\//, '').split('/')[0];

  return (
    <div
      className="sticky top-0 z-[100] bg-amber-500 text-amber-950 text-center text-[11px] font-bold tracking-wide py-1 px-2"
      role="status"
    >
      STAGING BUILD · {host} · not production
    </div>
  );
}
