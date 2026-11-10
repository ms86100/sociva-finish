// @ts-nocheck
import { cn } from '@/lib/utils';

export type RideWorkspaceTab = 'trip' | 'chat' | 'safety' | 'more';

const ALL_TABS: Array<{ id: RideWorkspaceTab; label: string }> = [
  { id: 'trip', label: 'Trip' },
  { id: 'chat', label: 'Chat' },
  { id: 'safety', label: 'Safety' },
  { id: 'more', label: 'More' },
];

type Props = {
  value: RideWorkspaceTab;
  onChange: (tab: RideWorkspaceTab) => void;
  badges?: Partial<Record<RideWorkspaceTab, number | boolean>>;
  /** Limit visible tabs by ride phase (e.g. started → Trip + Safety only). */
  visible?: RideWorkspaceTab[];
};

export function RideWorkspaceTabs({ value, onChange, badges, visible }: Props) {
  const tabs = visible?.length
    ? ALL_TABS.filter((t) => visible.includes(t.id))
    : ALL_TABS;

  if (tabs.length <= 1) return null;

  return (
    <div
      className="sticky top-0 z-10 -mx-1 rounded-2xl border border-border bg-background/95 p-1 backdrop-blur"
      data-testid="cleaner-city-ride-tabs"
      role="tablist"
      aria-label="Ride sections"
    >
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const active = value === tab.id;
          const badge = badges?.[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`cleaner-city-ride-tab-${tab.id}`}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative rounded-xl px-2 py-2.5 text-[12px] font-extrabold transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {tab.label}
              {badge ? (
                <span
                  className={cn(
                    'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
                    active ? 'bg-primary-foreground' : 'bg-primary',
                  )}
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
