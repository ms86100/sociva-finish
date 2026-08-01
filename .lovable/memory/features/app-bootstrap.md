---
name: App bootstrap single-request config
description: All static config (system_settings, admin_settings, parent_groups, category_config, badge_config) loads via one get_app_bootstrap RPC through src/lib/app-bootstrap.ts
type: feature
---

Every Supabase round-trip on this project costs ~0.5-1.0s of fixed overhead
regardless of payload size (shared-CPU instance, 430 RLS policies, ~6s cold
planning). Request COUNT is the dominant performance factor, not data volume.

**All static reference data loads through ONE call.**

- DB: `public.get_app_bootstrap()` — STABLE SECURITY DEFINER, returns jsonb with
  keys `system_settings`, `admin_settings`, `parent_groups`, `category_config`,
  `badge_config`. Executable by anon + authenticated. ~8.8 KB gzipped.
- Client: `src/lib/app-bootstrap.ts` → `loadAppBootstrap()`. Does in-flight
  de-duplication, a 30-min TTL, and localStorage persistence
  (key `app-bootstrap-v1`) with stale-while-revalidate, so a returning user's
  first paint issues zero config requests.

Consumers that MUST route through it (never re-add direct table queries here):
`useMarketplaceConfig`, `useParentGroups`, `useBadgeConfig`, `useStatusLabels`,
`useCategoryBehavior.fetchCategoryConfigs`, `services/trackingConfig.ts`, and the
deferred prefetches in `contexts/auth/AuthProvider.tsx`.

**How to apply:** need another piece of near-static config on startup? Extend the
`get_app_bootstrap` RPC and read it from the snapshot. Do NOT add a new
`supabase.from(...)` query for it. Call `invalidateAppBootstrap()` after admin
screens edit these tables.

Admin-only screens (CategoryManager, LicenseManager, PlatformSettingsManager,
etc.) may still query these tables directly — they need writes and full rows,
and are not on the startup path.

Covered by `src/test/app-bootstrap.test.ts` (request-count assertions).
