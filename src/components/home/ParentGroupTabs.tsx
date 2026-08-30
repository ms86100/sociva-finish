// @ts-nocheck
import { useParentGroups, ParentGroupInfo } from '@/hooks/useParentGroups';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { motion } from 'framer-motion';
import { useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';

interface ParentGroupTabsProps {
  activeGroup: string | null;
  onGroupChange: (slug: string | null) => void;
  activeParentGroups?: Set<string>;
  festivalTabs?: { value: string; label: string }[];
}

// Warm tint per category type for visual variety
const GROUP_ACCENTS: Record<string, { gradient: string; iconBg: string }> = {
  food: { gradient: 'from-orange-500/20 via-amber-500/10 to-transparent', iconBg: 'bg-orange-500/15' },
  food_beverages: { gradient: 'from-orange-500/20 via-amber-500/10 to-transparent', iconBg: 'bg-orange-500/15' },
  services: { gradient: 'from-blue-500/20 via-sky-500/10 to-transparent', iconBg: 'bg-blue-500/15' },
  home_services: { gradient: 'from-blue-500/20 via-sky-500/10 to-transparent', iconBg: 'bg-blue-500/15' },
  classes: { gradient: 'from-violet-500/20 via-purple-500/10 to-transparent', iconBg: 'bg-violet-500/15' },
  education_learning: { gradient: 'from-violet-500/20 via-purple-500/10 to-transparent', iconBg: 'bg-violet-500/15' },
  education: { gradient: 'from-violet-500/20 via-purple-500/10 to-transparent', iconBg: 'bg-violet-500/15' },
  fitness_wellness: { gradient: 'from-emerald-500/20 via-green-500/10 to-transparent', iconBg: 'bg-emerald-500/15' },
  personal: { gradient: 'from-pink-500/20 via-rose-500/10 to-transparent', iconBg: 'bg-pink-500/15' },
  personal_care: { gradient: 'from-pink-500/20 via-rose-500/10 to-transparent', iconBg: 'bg-pink-500/15' },
  professional: { gradient: 'from-teal-500/20 via-cyan-500/10 to-transparent', iconBg: 'bg-teal-500/15' },
  rentals: { gradient: 'from-sky-500/20 via-blue-500/10 to-transparent', iconBg: 'bg-sky-500/15' },
  resale: { gradient: 'from-amber-500/20 via-yellow-500/10 to-transparent', iconBg: 'bg-amber-500/15' },
  domestic_help: { gradient: 'from-indigo-500/20 via-blue-500/10 to-transparent', iconBg: 'bg-indigo-500/15' },
  events: { gradient: 'from-rose-500/20 via-pink-500/10 to-transparent', iconBg: 'bg-rose-500/15' },
  pets: { gradient: 'from-lime-500/20 via-green-500/10 to-transparent', iconBg: 'bg-lime-500/15' },
  property: { gradient: 'from-slate-500/20 via-gray-500/10 to-transparent', iconBg: 'bg-slate-500/15' },
};

const DEFAULT_ACCENT = {
  gradient: 'from-primary/20 via-primary/5 to-transparent',
  iconBg: 'bg-primary/15',
};

export function ParentGroupTabs({ activeGroup, onGroupChange, activeParentGroups, festivalTabs = [] }: ParentGroupTabsProps) {
  const { parentGroupInfos, isLoading } = useParentGroups();
  const takeover = useFestivalTakeover();
  const filteredGroups = activeParentGroups
    ? parentGroupInfos.filter(g => activeParentGroups.has(g.value))
    : parentGroupInfos;

  const barStyle = takeover.active
    ? { backgroundColor: takeover.bg, borderColor: 'rgba(255,255,255,0.12)' }
    : undefined;

  if (!isLoading && filteredGroups.length === 0 && festivalTabs.length === 0) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          'sticky top-[max(var(--app-safe-top),3.25rem)] z-20 px-4 py-2',
          takeover.active ? 'border-b border-white/10' : 'bg-background/80 backdrop-blur-xl border-b border-border/30'
        )}
        style={barStyle}
      >
        <div className="flex gap-2.5 overflow-x-auto scrollbar-hide">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="w-28 h-10 rounded-full shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  // Always horizontal scrollable chips — works for 1 or N groups
  const showAll = filteredGroups.length > 1 || festivalTabs.length > 0;
  const tabs: ParentGroupInfo[] = [
    ...(showAll ? [{ value: '__all__', label: 'All', icon: 'LayoutGrid', color: '', description: '', layoutType: 'ecommerce' as const }] : []),
    ...festivalTabs.map((f) => ({
      value: f.value,
      label: f.label,
      icon: 'Sparkles',
      color: '',
      description: '',
      layoutType: 'ecommerce' as const,
    })),
    ...filteredGroups,
  ];

  return (
    <div
      className={cn(
        'sticky top-[max(var(--app-safe-top),3.25rem)] z-20',
        takeover.active ? 'border-b border-white/10' : 'bg-background/80 backdrop-blur-xl border-b border-border/30'
      )}
      style={barStyle}
    >
      <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-2">
        {tabs.map((tab, index) => {
          const isAll = tab.value === '__all__';
          const isFestival = tab.value === '__festival__' || tab.value.startsWith('__festival__');
          const isActive = isAll ? activeGroup === null : activeGroup === tab.value;
          const accent = GROUP_ACCENTS[tab.value] || DEFAULT_ACCENT;

          return (
            <motion.button
              key={tab.value}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04, duration: 0.25 }}
              onClick={() => {
                hapticSelection();
                onGroupChange(isAll ? null : (activeGroup === tab.value ? null : tab.value));
              }}
              className={cn(
                'flex items-center gap-2 shrink-0 px-3.5 py-2 rounded-full transition-all duration-300 relative overflow-hidden',
                'border',
                takeover.active
                  ? isActive
                    ? 'bg-white/15 border-white/25 text-white'
                    : 'bg-transparent border-white/10 text-white/75 active:scale-95'
                  : isActive
                    ? isFestival
                      ? 'bg-amber-500/15 border-amber-500/35 text-amber-700 dark:text-amber-300'
                      : 'bg-primary/12 border-primary/30 shadow-[0_0_12px_hsl(var(--primary)/0.1)] text-primary'
                    : 'bg-card/50 border-border/25 text-muted-foreground hover:bg-card/70 active:scale-95'
              )}
            >
              {isActive && !takeover.active && (
                <div className={cn(
                  'absolute inset-0 bg-gradient-to-r pointer-events-none opacity-40',
                  accent.gradient
                )} />
              )}

              <div className={cn(
                'relative w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 overflow-hidden',
                takeover.active
                  ? isActive ? 'bg-white/20' : 'bg-white/10'
                  : isActive ? accent.iconBg : 'bg-muted/40'
              )}>
                {isAll ? (
                  <DynamicIcon name="LayoutGrid" size={12} />
                ) : isFestival ? (
                  <DynamicIcon name="Sparkles" size={12} />
                ) : tab.imageUrl ? (
                  <img src={tab.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs">{tab.icon || '📦'}</span>
                )}
              </div>

              <span className={cn(
                'relative text-xs whitespace-nowrap transition-all duration-300',
                isActive ? 'font-semibold' : 'font-medium'
              )}>
                {tab.label}
              </span>

              {isActive && takeover.active && (
                <span
                  className="absolute bottom-0.5 left-4 right-4 h-0.5 rounded-full"
                  style={{ backgroundColor: takeover.accent }}
                />
              )}

              {isActive && !takeover.active && (
                <motion.div
                  layoutId="activeGroupPill"
                  className="absolute inset-0 rounded-full bg-primary/10 border border-primary/25"
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  style={{ zIndex: -1 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
