// @ts-nocheck
import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookOpen, KeyRound, Home, ShoppingBag, Store, Truck, Shield, Users, ChevronRight, Calendar, Package } from 'lucide-react';
import { AuthOnboardingDocs } from '@/components/docs/AuthOnboardingDocs';
import { HomeDiscoveryDocs } from '@/components/docs/HomeDiscoveryDocs';
import { ServiceBookingDocs } from '@/components/docs/ServiceBookingDocs';
import { MarketplaceShoppingDocs } from '@/components/docs/MarketplaceShoppingDocs';
import { SellerToolsDocs } from '@/components/docs/SellerToolsDocs';
import { DeliveryDocs } from '@/components/docs/DeliveryDocs';
import { AdminCommunityDocs } from '@/components/docs/AdminCommunityDocs';
import { WorkflowEngineDocs } from '@/components/docs/WorkflowEngineDocs';
import { cn } from '@/lib/utils';

const NAV_SECTIONS = [
  {
    group: 'Getting Started',
    items: [
      { id: 'auth', label: 'Auth & Onboarding', icon: KeyRound },
      { id: 'home', label: 'Home & Discovery', icon: Home },
    ],
  },
  {
    group: 'Marketplace',
    items: [
      { id: 'marketplace', label: 'Shopping & Orders', icon: ShoppingBag },
      { id: 'service-booking', label: 'Service Booking', icon: Calendar },
    ],
  },
  {
    group: 'Selling',
    items: [
      { id: 'seller', label: 'Seller Tools', icon: Store },
    ],
  },
  {
    group: 'Operations',
    items: [
      { id: 'delivery', label: 'Delivery & Logistics', icon: Truck },
      { id: 'workflows', label: 'Workflow Engine', icon: Package },
    ],
  },
  {
    group: 'Platform',
    items: [
      { id: 'admin', label: 'Admin & Community', icon: Shield },
    ],
  },
];

const MODULE_COMPONENTS: Record<string, React.FC> = {
  auth: AuthOnboardingDocs,
  home: HomeDiscoveryDocs,
  marketplace: MarketplaceShoppingDocs,
  'service-booking': ServiceBookingDocs,
  seller: SellerToolsDocs,
  delivery: DeliveryDocs,
  workflows: WorkflowEngineDocs,
  admin: AdminCommunityDocs,
};

export default function DocumentationPage() {
  const [activeModule, setActiveModule] = useState('auth');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const ActiveComponent = MODULE_COMPONENTS[activeModule];

  const activeLabel = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.id === activeModule)?.label || '';

  return (
    <AppLayout headerTitle="Documentation">
      <div className="flex h-[calc(100dvh-3.5rem)]">
        {/* ─── Left Sidebar (Desktop) ─── */}
        <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-muted/30">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <BookOpen className="text-primary-foreground" size={16} />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Platform Docs</p>
                <p className="text-[10px] text-muted-foreground">Complete Reference</p>
              </div>
            </div>
          </div>
          <ScrollArea className="flex-1 py-2">
            {NAV_SECTIONS.map((section) => (
              <div key={section.group} className="mb-1">
                <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{section.group}</p>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeModule === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveModule(item.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </ScrollArea>
        </aside>

        {/* ─── Mobile Nav Toggle ─── */}
        <div className="md:hidden absolute top-[3.5rem] left-0 right-0 z-10 bg-background border-b border-border">
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground"
          >
            <span className="flex items-center gap-2">
              <BookOpen size={14} className="text-primary" />
              {activeLabel}
            </span>
            <ChevronRight size={14} className={cn('transition-transform', mobileNavOpen && 'rotate-90')} />
          </button>

          {mobileNavOpen && (
            <div className="bg-background border-b border-border pb-2 shadow-lg">
              {NAV_SECTIONS.map((section) => (
                <div key={section.group}>
                  <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{section.group}</p>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeModule === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveModule(item.id); setMobileNavOpen(false); }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-6 py-2 text-left text-sm transition-colors',
                          isActive ? 'text-primary font-medium bg-primary/5' : 'text-muted-foreground'
                        )}
                      >
                        <Icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Main Content ─── */}
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:pt-6 pt-14">
            {ActiveComponent && <ActiveComponent />}

            {/* Footer */}
            <div className="pt-8 pb-12 border-t border-border mt-8 text-center">
              <p className="text-[11px] text-muted-foreground">
                Platform Documentation · Last updated March 2026
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                7 modules · Comprehensive system reference
              </p>
            </div>
          </div>
        </ScrollArea>
      </div>
    </AppLayout>
  );
}
