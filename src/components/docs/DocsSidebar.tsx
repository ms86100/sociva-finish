// @ts-nocheck
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LogIn, Home, ShoppingCart, Calendar, Store, Truck, Shield,
  ChevronDown, BookOpen, Users, Package, Wrench, Building2,
  MessageSquare, Car, UserCheck, ClipboardList, Bell, BarChart3,
  Briefcase
} from 'lucide-react';

export type DocModule =
  | 'auth-onboarding'
  | 'home-discovery'
  | 'marketplace-shopping'
  | 'service-booking'
  | 'seller-tools'
  | 'delivery-logistics'
  | 'admin-community';

interface NavGroup {
  label: string;
  items: { id: DocModule; label: string; icon: React.ElementType }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Getting Started',
    items: [
      { id: 'auth-onboarding', label: 'Auth & Onboarding', icon: LogIn },
      { id: 'home-discovery', label: 'Home & Discovery', icon: Home },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { id: 'marketplace-shopping', label: 'Shopping & Orders', icon: ShoppingCart },
      { id: 'service-booking', label: 'Service Booking', icon: Calendar },
    ],
  },
  {
    label: 'Selling',
    items: [
      { id: 'seller-tools', label: 'Seller Tools', icon: Store },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'delivery-logistics', label: 'Delivery & Logistics', icon: Truck },
    ],
  },
  {
    label: 'Platform',
    items: [
      { id: 'admin-community', label: 'Admin & Community', icon: Shield },
    ],
  },
];

interface DocsSidebarProps {
  activeModule: DocModule;
  onModuleChange: (module: DocModule) => void;
}

export function DocsSidebar({ activeModule, onModuleChange }: DocsSidebarProps) {
  return (
    <nav className="space-y-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-2">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onModuleChange(item.id)}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// Mobile dropdown version
export function DocsSidebarMobile({ activeModule, onModuleChange }: DocsSidebarProps) {
  const [open, setOpen] = useState(false);
  const allItems = navGroups.flatMap(g => g.items);
  const current = allItems.find(i => i.id === activeModule);

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium"
      >
        <div className="flex items-center gap-2">
          {current && <current.icon size={16} className="text-primary" />}
          <span>{current?.label || 'Select module'}</span>
        </div>
        <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 pt-3 pb-1">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onModuleChange(item.id); setOpen(false); }}
                    className={cn(
                      'flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-colors',
                      activeModule === item.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground/70 hover:bg-muted'
                    )}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
