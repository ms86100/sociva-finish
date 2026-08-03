# Phase 1 defects — fix status

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| DEF-001 | Blocker | `Test` / `hello section` parent groups shown | DB `is_active=false` + bootstrap RPC active-only + FE picker filter |
| DEF-002 | Major | Duplicate groups (food/classes/personal/services) | Same: deactivated legacy slugs; FE `LEGACY_PARENT_GROUP_SLUGS` hide |
| DEF-003 | Major | Home 67% / Set location vs unit A-101 | Profile banner: name+flat only; Header falls back to flat/block |
| DEF-004 | Minor | Wrong OTP toast only | Inline `otpError` under OTP slots |
| DEF-005 | Minor | “Open every day” not clickable | Toggle button selects/clears all days |
| DEF-006 | Info | Product image required | No change (AI Generate works) |
| DEF-007 | Info | Plan `food_beverages` vs live `food` | Matrix updated; S1 kept on `food` |
| DEF-008 | Major | Full-viewport SOCIVA splash can intercept clicks after fade | Force `onComplete` after max display; prevent double-complete |
| DEF-009 | Major | Configure title/content mismatch from stale `onboarding_config_substep` | Reset substep on step 1 and on 4→5 transition |
| DEF-010 | Blocker | Pause→Resume / Save trapped by stale `accepts_upi` vs Online toggles | Gate + save validation use payment configs only (`useSellerSettings`, dashboard) |
| DEF-011 | Major | `#root` blank / `display:none` after seller navigations | CSS force-visible `#root` + SplashGate MutationObserver clears inline hide |
| DEF-012 | Minor | Edit product step chrome advances while Basics body sticks | Open |
| DEF-013 | Info | Contact products forced to ₹1 by price requirement trigger | Open / product policy |

## Deployed to prod DB already
- Parent group deactivation
- `get_app_bootstrap` active-only parent_groups
- S1–S4 approved; S1 COD-only + open after pause trap
- `whatsapp_messages` table + WhatsApp credential keys

## Needs FE deploy for full effect
DEF-003, 004, 005, 008, 009, 010, 011 (+ Admin Developer Tools / WhatsApp test UI)
