// @ts-nocheck
import { Link } from 'react-router-dom';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';

/**
 * Book-tab entry for A Cleaner City. Hidden unless society feature is enabled.
 * Unit 1: navigation shell only - no live matches.
 */
export function CleanerCityEntryCard() {
  const { isFeatureEnabled, isLoading } = useEffectiveFeatures();

  if (isLoading || !isFeatureEnabled('cleaner_city')) return null;

  return (
    <Link
      to="/cleaner-city"
      data-testid="cleaner-city-entry-card"
      className="mx-4 mt-2.5 block overflow-hidden rounded-[26px] border border-white/10 bg-[#0D3327] px-4 py-4 text-left text-white shadow-[0_22px_48px_-24px_rgba(13,51,39,0.95)] transition-transform active:scale-[0.99]"
    >
      <p className="text-[11px] font-extrabold tracking-tight text-white">sociva</p>
      <p className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-[#A3C9A8]">
        A Cleaner City
      </p>
      <p className="mt-1.5 max-w-[18rem] text-[13px] font-medium text-white/90">
        Your daily commute. Shared with your community.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full bg-[#144536] px-2.5 py-1 text-[11px] font-bold text-[#A3C9A8] ring-1 ring-white/5">
          Verified commuters
        </span>
        <span className="inline-flex items-center rounded-full bg-[#144536] px-2.5 py-1 text-[11px] font-bold text-[#A3C9A8] ring-1 ring-white/5">
          Smart route matching
        </span>
      </div>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7BA88A]">
        New experience
      </p>
    </Link>
  );
}
