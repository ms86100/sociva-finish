---
name: Performance rules
description: Query caching policies, tab-lazy loading patterns, telemetry guardrails
type: preference
---

- Global QueryClient: staleTime 10min, refetchOnWindowFocus false, retry 1
- Cart queries: staleTime 30s, refetchOnWindowFocus false, refetchOnMount 'always'
- Cart count: staleTime 30s
- Notification count: staleTime 30s, refetchInterval 60s
- Header society stats: staleTime 15min
- Seller order stats: staleTime 30s
- Seller orders infinite: staleTime 15s
- Order detail: staleTime 30s, realtime subscription + 45s heartbeat for active orders
- Admin data: tab-lazy — core (stats + sellers) loads on mount; reviews/payments/reports/warnings/societies load when tab activated
- HomePage: uses LazySection — never add duplicate IntersectionObservers
- Use perf-telemetry.ts guardedQuery() for new DB-heavy queries
- Use trackRouteMount() in page useEffect for route timing visibility
- Never set refetchOnWindowFocus: true on any query