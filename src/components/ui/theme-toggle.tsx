// @ts-nocheck
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

const themes = [
  { key: 'light', icon: Sun, label: 'Light' },
  { key: 'dark', icon: Moon, label: 'Dark' },
] as const;

/** Compact 2-button pill for the header */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-full bg-secondary/70 p-0.5', className)}>
      {themes.map(({ key, icon: Icon, label }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            className={cn(
              'flex items-center justify-center h-7 w-7 rounded-full transition-all duration-200',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            )}
            aria-label={label}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={active ? 2.4 : 1.8} />
          </button>
        );
      })}
    </div>
  );
}

/** Expanded picker for settings / profile pages */
export function ThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {themes.map(({ key, icon: Icon, label }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all duration-300 text-sm font-semibold',
              active
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
            )}
            aria-label={label}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
