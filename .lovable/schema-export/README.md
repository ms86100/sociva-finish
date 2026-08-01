# Complete Database Schema Export

> Generated: 2026-03-12
> Database: Sociva Platform (Lovable Cloud)

## Summary

| Section | File | Count |
|---|---|---|
| Custom Enum Types | `01-enums.sql` | 6 types |
| CREATE TABLE Statements | `02-tables.sql` | 143 tables |
| Foreign Key Constraints | `03-foreign-keys.sql` | ~200 constraints |
| Indexes | `04-indexes.sql` | ~260 indexes |
| RLS Policies | `05-rls-policies.sql` | ~200 policies |
| Database Functions | `06-functions.sql` | ~80 functions |
| Triggers | `07-triggers.sql` | ~77 triggers |
| Realtime Configuration | `08-realtime.sql` | 16 tables |
| Seed Data Reference | `09-seed-data.md` | Edge function reference |

## How to Use

- **Recreate from scratch**: Run files 01 → 08 in order
- **Review security**: Focus on `05-rls-policies.sql` and `06-functions.sql` (SECURITY DEFINER functions)
- **Understand data model**: Start with `02-tables.sql` + `03-foreign-keys.sql`
- **Seed test data**: See `09-seed-data.md` for the edge function pattern

## Related Docs

- `.lovable/rls-policy-map.md` — Role-based access matrix
- `.lovable/hardening-docs/trigger-registry.md` — Trigger inventory
- `.lovable/hardening-docs/role-access-matrix.md` — Per-role access table
- `.lovable/hardening-docs/rls-test-plan.md` — Validation queries
