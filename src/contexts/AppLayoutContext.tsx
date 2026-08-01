// @ts-nocheck
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface AppLayoutOptions {
  showHeader?: boolean;
  showNav?: boolean;
  showCart?: boolean;
  showLocation?: boolean;
  showBack?: boolean;
  headerTitle?: string;
  className?: string;
}

export const DEFAULT_LAYOUT_OPTIONS: Required<Omit<AppLayoutOptions, 'headerTitle' | 'showBack' | 'className'>> &
  Pick<AppLayoutOptions, 'headerTitle' | 'showBack' | 'className'> = {
  showHeader: true,
  showNav: true,
  showCart: true,
  showLocation: true,
  showBack: undefined,
  headerTitle: undefined,
  className: undefined,
};

type SetLayoutOptions = (next: AppLayoutOptions) => void;

/** Stable setter — identity never changes with options updates. */
const AppLayoutSetOptionsContext = createContext<SetLayoutOptions | null>(null);
/** Whether chrome is owned by AppShell. */
const AppLayoutPersistentContext = createContext(false);
/** Current chrome options (for AppShellChrome only). */
const AppLayoutOptionsContext = createContext<AppLayoutOptions>(DEFAULT_LAYOUT_OPTIONS);

function normalizeOptions(next: AppLayoutOptions): AppLayoutOptions {
  return {
    showHeader: next.showHeader ?? true,
    showNav: next.showNav ?? true,
    showCart: next.showCart ?? true,
    showLocation: next.showLocation ?? true,
    showBack: next.showBack,
    headerTitle: next.headerTitle,
    className: next.className,
  };
}

/** Pure equality — setOptions must bail when unchanged to avoid max-update-depth loops. */
export function optionsEqual(a: AppLayoutOptions, b: AppLayoutOptions): boolean {
  return (
    a.showHeader === b.showHeader &&
    a.showNav === b.showNav &&
    a.showCart === b.showCart &&
    a.showLocation === b.showLocation &&
    a.showBack === b.showBack &&
    a.headerTitle === b.headerTitle &&
    a.className === b.className
  );
}

export function normalizeLayoutOptions(next: AppLayoutOptions): AppLayoutOptions {
  return normalizeOptions(next);
}

export function AppLayoutShellProvider({ children }: { children: ReactNode }) {
  const [options, setOptionsState] = useState<AppLayoutOptions>(DEFAULT_LAYOUT_OPTIONS);

  const setOptions = useCallback((next: AppLayoutOptions) => {
    const normalized = normalizeOptions(next);
    setOptionsState((prev) => (optionsEqual(prev, normalized) ? prev : normalized));
  }, []);

  return (
    <AppLayoutPersistentContext.Provider value={true}>
      <AppLayoutSetOptionsContext.Provider value={setOptions}>
        <AppLayoutOptionsContext.Provider value={options}>
          {children}
        </AppLayoutOptionsContext.Provider>
      </AppLayoutSetOptionsContext.Provider>
    </AppLayoutPersistentContext.Provider>
  );
}

/** For AppLayout pages — stable setters, no options identity churn. */
export function useAppLayoutShell() {
  const setOptions = useContext(AppLayoutSetOptionsContext);
  const isPersistent = useContext(AppLayoutPersistentContext);
  if (!setOptions || !isPersistent) return null;
  return { setOptions, isPersistent: true as const };
}

/** For AppShellChrome — subscribe to options only. */
export function useAppLayoutOptions() {
  return useContext(AppLayoutOptionsContext);
}
