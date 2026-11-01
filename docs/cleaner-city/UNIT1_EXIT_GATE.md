# Unit 1 exit gate checklist

- [x] Architecture doc: `docs/cleaner-city/ARCHITECTURE.md`
- [x] API contracts: `docs/cleaner-city/API_CONTRACTS_UNIT1.md`
- [x] Foundation migration: `supabase/migrations/20261102090000_cleaner_city_foundation.sql`
- [x] Rollback note: `supabase/rollbacks/20261102090000_cleaner_city_foundation.rollback.sql`
- [x] Feature key `cleaner_city` in `useEffectiveFeatures`
- [x] `/cleaner-city` hub shell + `CleanerCityGate`
- [x] Book tab entry card (feature-gated)
- [x] Admin stub tab
- [x] Security/regression tests (`cleaner-city-security.test.ts`, `cleaner-city-entry.test.tsx`)
- [x] No fabricated match/ride flows
- [x] No work-email OTP send (Unit 2 dependency)
- [x] Existing Book commerce classification unchanged

Rollback preference: disable feature for societies, then optional SQL rollback.
