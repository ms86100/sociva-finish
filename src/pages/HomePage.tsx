// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { OnboardingWalkthrough, useOnboarding } from '@/components/onboarding/OnboardingWalkthrough';

import { MarketplaceSection } from '@/components/home/MarketplaceSection';
import { SocietyQuickLinks } from '@/components/home/SocietyQuickLinks';

import { CommunityTeaser } from '@/components/home/CommunityTeaser';
import { LazySection } from '@/components/home/LazySection';
import { HomeNotificationBanner } from '@/components/notifications/HomeNotificationBanner';
import { PreciseLocationRequiredCard } from '@/components/location/PreciseLocationRequiredCard';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { hasPreciseCoordinates } from '@/lib/buyerLocation';
import { ActiveOrderStrip } from '@/components/home/ActiveOrderStrip';
import { ForYouSection } from '@/components/home/ForYouSection';
import { SocietyLeaderboard } from '@/components/home/SocietyLeaderboard';
import { RecentlyViewedRow } from '@/components/home/RecentlyViewedRow';
import { WelcomeBackStrip } from '@/components/home/WelcomeBackStrip';
import { WhatsNewSection } from '@/components/home/WhatsNewSection';
import { HomeSearchSuggestions } from '@/components/home/HomeSearchSuggestions';

import { useAuth } from '@/contexts/AuthContext';
import { useBuyerRealtimeShell } from '@/hooks/useBuyerRealtimeShell';
import { prefetchBuyerRoutes } from '@/lib/route-prefetch';
import { trackRouteMount } from '@/lib/perf-telemetry';

export default function HomePage() {
  useBuyerRealtimeShell();
  const { user, profile } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const needsPreciseLocation = !hasPreciseCoordinates(browsingLocation?.lat, browsingLocation?.lng);
  const { showOnboarding, hasChecked, completeOnboarding } = useOnboarding(user?.id);

  const scrollKey = 'home-scroll-y';
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (!hasRestoredRef.current && profile) {
      const saved = sessionStorage.getItem(scrollKey);
      if (saved) {
        requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
      }
      hasRestoredRef.current = true;
    }
    return () => {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
    };
  }, [profile]);

  useEffect(() => {
    trackRouteMount('HomePage');
    prefetchBuyerRoutes();
  }, []);

  if (profile && (!profile.name || profile.name === 'User')) {
    return <Navigate to="/profile/edit" replace />;
  }

  if (hasChecked && showOnboarding && profile) {
    return (
      <AppLayout showHeader={false} showNav={false} showCart={false}>
        <OnboardingWalkthrough onComplete={completeOnboarding} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="pb-4 space-y-0">
        <HomeNotificationBanner />
        {needsPreciseLocation && <PreciseLocationRequiredCard className="mx-4 mt-3" />}
        <ActiveOrderStrip />
        <HomeSearchSuggestions />
        <MarketplaceSection />

        {profile && (() => {
          // Require name + flat for delivery; block/tower is optional enrichment (DEF-003)
          const missing: string[] = [];
          if (!profile.name) missing.push('name');
          if (!profile.flat_number) missing.push('flat number');
          if (missing.length === 0) return null;
          const total = 2;
          const pct = Math.round(((total - missing.length) / total) * 100);
          return (
            <div className="mx-4 mt-5 rounded-2xl bg-card border border-border p-4 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-foreground">Profile {pct}% complete</p>
                <Link to="/profile/edit" className="text-xs font-bold text-primary shrink-0 hover:underline">Update</Link>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Add your {missing.join(' and ')} so sellers can deliver to the right door
              </p>
            </div>
          );
        })()}

        {/* Below-fold — mount on scroll to cut home query fan-out.
            Do not use reveal-on-scroll: nothing adds .revealed, so sections
            stayed opacity:0 and left a huge blank band above BottomNav. */}
        <LazySection>
          <WelcomeBackStrip />
        </LazySection>
        <LazySection>
          <ForYouSection />
        </LazySection>
        <LazySection>
          <RecentlyViewedRow />
        </LazySection>
        <LazySection>
          <WhatsNewSection />
        </LazySection>
        <LazySection>
          <SocietyQuickLinks />
        </LazySection>
        <LazySection className="mt-2">
          <SocietyLeaderboard />
        </LazySection>
        <LazySection>
          <CommunityTeaser />
        </LazySection>
      </div>
    </AppLayout>
  );
}
