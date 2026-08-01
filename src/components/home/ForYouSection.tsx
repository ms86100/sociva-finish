// @ts-nocheck
import { SmartSuggestionBanner } from '@/components/home/SmartSuggestionBanner';
import { ArrivalSuggestionCard } from '@/components/home/ArrivalSuggestionCard';
import { UpcomingAppointmentBanner } from '@/components/home/UpcomingAppointmentBanner';

/**
 * Perf: Removed duplicate BuyAgainRow — it already renders inside MarketplaceSection.
 * Each child returns null when empty, so we just render them.
 */
export function ForYouSection() {
  return (
    <div className="mt-1 space-y-1 empty:hidden">
      <ArrivalSuggestionCard />
      <SmartSuggestionBanner />
      <div className="px-4">
        <UpcomingAppointmentBanner />
      </div>
    </div>
  );
}
