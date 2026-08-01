// @ts-nocheck
/**
 * Pass-through wrapper.
 * Route fade/slide animations were re-running on every navigation and costing
 * main-thread time on Capacitor WebViews. Keep the component so App.tsx call
 * sites stay stable, but do no animation work.
 */
export function PageTransitionWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
