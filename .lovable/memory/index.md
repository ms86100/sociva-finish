# Project Memory

## Core
Request COUNT dominates perf here — each Supabase round-trip costs ~0.5-1.0s fixed. Collapse calls, don't optimise payloads.
Static config loads via ONE get_app_bootstrap RPC through src/lib/app-bootstrap.ts. Never add direct startup queries to system_settings/admin_settings/parent_groups/category_config/badge_config.
Cart staleTime 30s, refetchOnWindowFocus false. Global QueryClient default staleTime 10min, refetchOnWindowFocus false.
Admin data is tab-lazy — only fetches stats+sellers on mount, other tabs load on-demand.
HomePage uses LazySection for deferred rendering — do NOT add duplicate IntersectionObservers.
All critical DB indexes already exist (orders, cart_items, products, seller_profiles, notifications).

## Memories
- [App bootstrap](mem://features/app-bootstrap) — Single-request static config RPC, persistence, which hooks must route through it
- [Refund seller visibility](mem://features/refund-seller-visibility) — Seller dashboard refund requests depend on refund_requests RLS for seller-owned orders
- [Performance rules](mem://preferences/performance-rules) — Query staleTime policies, no global refetchOnWindowFocus, tab-lazy admin, telemetry guardrails
