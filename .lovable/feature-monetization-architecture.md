# Feature Monetization Architecture

## Status: IMPLEMENTED

## 4-Tier Resolution Hierarchy
```
Platform Features → Feature Packages → Builder Assignments → Society Overrides
```

## Tables Created
1. **platform_features** — Master catalog (15 seeded, scales to 200+)
2. **feature_packages** — Bundles (Basic/Pro/Enterprise)
3. **feature_package_items** — Features in each package
4. **builder_feature_packages** — Package assigned to builder
5. **society_feature_overrides** — Per-society overrides

## RPC Functions
- `get_effective_society_features(society_id)` — Resolves final feature state
- `is_feature_enabled_for_society(society_id, feature_key)` — Boolean helper for RLS

## Frontend
- `useEffectiveFeatures` hook — Calls RPC, 5-min cache
- `useSocietyFeatures` — Re-exports for backward compat
- `FeatureGate` — Uses new hook
- `BottomNav` — Uses new hook
- `SocietyAdminPage` — 3-state toggles (Locked/Configurable/Unavailable)
- `AdminPage > Features tab` — Full CRUD for features, packages, builder assignments

## Backward Compatibility
- Societies without a builder → all features default to enabled
- Existing FeatureGate API unchanged
- society_features table retained (deprecated)

## Security
- RLS on all 5 tables
- Builder isolation via builder_members check
- Society isolation via society_id scoping
- Platform admin override on all tables
- `is_feature_enabled_for_society()` available for write-path RLS protection
