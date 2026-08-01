// @ts-nocheck
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingTrustBar } from '@/components/landing/LandingTrustBar';
import { LandingPainPoints } from '@/components/landing/LandingPainPoints';
import { LandingFeatures } from '@/components/landing/LandingFeatures';
import { LandingHowItWorks } from '@/components/landing/LandingHowItWorks';
import { LandingTestimonials } from '@/components/landing/LandingTestimonials';
import { LandingPricing } from '@/components/landing/LandingPricing';
import { LandingFinalCTA } from '@/components/landing/LandingFinalCTA';
import { LandingFooter } from '@/components/landing/LandingFooter';

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-background overflow-y-auto">
      <LandingNav />
      <LandingHero />
      <LandingTrustBar />
      <LandingPainPoints />
      <LandingFeatures />
      <LandingHowItWorks />
      <LandingTestimonials />
      <LandingPricing />
      <LandingFinalCTA />
      <LandingFooter />
    </div>
  );
}