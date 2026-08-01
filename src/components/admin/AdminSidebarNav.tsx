// @ts-nocheck
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Store, Users, Building2, AlertCircle, LayoutGrid, Flag,
  CreditCard, Star, Megaphone, Layers, Settings2, Bot,
  Menu, ChevronRight, FileCode, Send, Package, Wrench, MessageSquare, KeyRound,
  BarChart3, GitBranch, FlaskConical,
} from 'lucide-react';
import { useState } from 'react';

const NAV_GROUPS = [
  {
    label: 'Commerce',
    items: [
      { value: 'sellers', label: 'Moderation', icon: Store },
      { value: 'payments', label: 'Payments', icon: CreditCard },
      { value: 'services', label: 'Services', icon: Wrench },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { value: 'workflows', label: 'Workflows', icon: GitBranch },
      { value: 'catalog', label: 'Categories', icon: LayoutGrid },
      { value: 'featured', label: 'Featured', icon: Megaphone },
    ],
  },
  {
    label: 'People',
    items: [
      { value: 'users', label: 'Users', icon: Users },
      { value: 'societies', label: 'Societies', icon: Building2 },
      { value: 'disputes', label: 'Disputes', icon: AlertCircle },
      { value: 'reports', label: 'Reports', icon: Flag },
      { value: 'reviews', label: 'Reviews', icon: Star },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { value: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [
      { value: 'features', label: 'Features', icon: Layers },
      { value: 'campaigns', label: 'Campaigns', icon: Send },
      { value: 'ai-review', label: 'AI Review', icon: Bot },
      { value: 'feedback', label: 'Feedback', icon: MessageSquare },
      { value: 'credentials', label: 'Credentials', icon: KeyRound },
      { value: 'test-scenarios', label: 'Test Runner', icon: FlaskConical },
      { value: 'settings', label: 'Settings', icon: Settings2 },
      { value: 'api-docs', label: 'API Docs', icon: FileCode },
    ],
  },
];

interface AdminSidebarNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function AdminSidebarNav({ activeTab, onTabChange }: AdminSidebarNavProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const ROUTE_ITEMS: Record<string, string> = { 'api-docs': '/api-docs' };
  const activeItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.value === activeTab);

  const navContent = (
    <ScrollArea className="h-full">
      <div className="py-3 px-2 space-y-5">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 px-3 mb-1.5">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.value;
                return (
                  <button
                    key={item.value}
                    onClick={() => {
                      if (ROUTE_ITEMS[item.value]) {
                        navigate(ROUTE_ITEMS[item.value]);
                      } else {
                        onTabChange(item.value);
                      }
                      setOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold shadow-sm'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    <Icon size={16} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                    <span className="truncate">{item.label}</span>
                    {isActive && <ChevronRight size={14} className="ml-auto text-primary/60" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );

  return (
    <>
      {/* Mobile: Sheet trigger button showing current section */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start gap-2.5 rounded-xl h-11 border-border/60 bg-background shadow-[var(--shadow-card)] font-semibold text-sm"
          >
            <Menu size={16} className="text-muted-foreground" />
            {activeItem && (
              <>
                <activeItem.icon size={15} className="text-primary" />
                <span>{activeItem.label}</span>
              </>
            )}
            <ChevronRight size={14} className="ml-auto text-muted-foreground" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] p-0 pt-12">
          <div className="px-4 pb-3 border-b border-border/30">
            <p className="text-xs font-bold text-foreground">Admin Navigation</p>
          </div>
          {navContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
