// @ts-nocheck
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Car, Leaf, Users } from 'lucide-react';

export default function CleanerCityPage() {
  return (
    <AppLayout headerTitle="A Cleaner City">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-hub">
          <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[#0D3327] px-4 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold tracking-tight">sociva</p>
                <h1 className="mt-1 text-[24px] font-extrabold leading-tight text-[#A3C9A8]">
                  A Cleaner City
                </h1>
                <p className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/80">
                  Commute together. Save more. Breathe better.
                </p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Leaf size={18} className="text-[#A3C9A8]" aria-hidden />
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              className="rounded-2xl border border-border bg-card p-4 opacity-80"
              data-testid="cleaner-city-offer-placeholder"
            >
              <Car size={18} className="text-primary mb-2" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Offer a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I have an empty seat</p>
              <p className="text-[10px] text-muted-foreground mt-3">Coming in a later unit</p>
            </div>
            <div
              className="rounded-2xl border border-border bg-card p-4 opacity-80"
              data-testid="cleaner-city-find-placeholder"
            >
              <Users size={18} className="text-primary mb-2" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Find a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I need a commute</p>
              <p className="text-[10px] text-muted-foreground mt-3">Coming in a later unit</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Foundation ready</p>
            <p className="text-xs text-muted-foreground mt-1">
              Unit 1 ships architecture, schema and this hub shell. Commute setup, matching and rides
              arrive in Units 2-8. Enable the feature only for pilot societies.
            </p>
          </div>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
