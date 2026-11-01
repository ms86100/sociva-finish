# Cleaner City - Pilot Success Metrics

Practical measurement plan for a first society-cluster pilot (Shriram Greenfield + configured neighbours).

All numeric targets below are **hypotheses**, not established benchmarks. Label them as such in any dashboard or board pack.

Instrumentation note: prefer events from existing tables (`commute_profiles`, `work_verifications`, `commute_publications`, `rides`, `ride_ratings`, `ride_cost_shares`, `ride_incidents`, `notification_queue`) plus a thin analytics event layer. Admin stub already exposes `cleaner_city_admin_stats` - extend rather than replace.

---

## 1. Funnel metrics

| Metric | Definition | How to compute | Pilot hypothesis (4 weeks) |
|--------|------------|----------------|----------------------------|
| Onboarding completion % | Users who open Cleaner City and reach `ready` (profile + verified + not paused + required pins) | `ready_users / unique_hub_openers` | **35-50%** of hub openers (hypothesis) |
| Corporate verification completion % | Verified work email / started OTP send | `work_verifications.status=verified` / OTP send attempts | **60-75%** of senders (hypothesis; domain friction will dominate) |
| Time to first compatible match | Median minutes from first Find search with valid pickup to first non-empty match list | Client event or server search log | **< 24 hours** wall-clock in thin supply; **< 2 minutes** when inventory exists (hypothesis) |
| Match-to-booking conversion | Ride requests / match impressions (or searches with >=1 result) | `rides` requested / searches_with_results | **20-35%** (hypothesis) |
| Booking-to-completed conversion | Completed rides / accepted (confirmed+) rides | `status=completed` / ever `confirmed` | **70-85%** after Reliability Net; **<60%** if no-shows unchecked (hypothesis) |

---

## 2. Habit and supply metrics

| Metric | Definition | Hypothesis |
|--------|------------|------------|
| Repeat commute rate | Users with >=2 completed rides in 14 days / users with >=1 | **40%+** after Autopilot (hypothesis); **<20%** without |
| Weekly active commuters (WAC) | Distinct users with publish, request, or completed ride in calendar week | Pilot exit bar: **40-80 WAC** in Greenfield cluster (hypothesis; depends on society size) |
| Driver seat utilisation | Seats filled / seats published (completed or started) | **25-40%** early; **50%+** healthy (hypothesis) |
| Autopilot coverage (once built) | Working-template user-days with live publication | **70%+** of autopilot-enabled hosts (hypothesis) |
| % users receiving a suitable match | Searches with >=1 result under detour threshold / all searches | **50%+** by week 4 evenings-before (hypothesis); week 1 may be **<20%** |

---

## 3. Reliability and safety

| Metric | Definition | Hypothesis / alert |
|--------|------------|--------------------|
| Cancellation rate | Cancels after confirm / confirmed rides | Keep **< 20%** (hypothesis); alert if **> 30%** |
| No-show rate | `no_show` / confirmed rides (once status wired) | Keep **< 8%** (hypothesis); alert **> 12%** |
| Request accept latency | Median time requested -> accepted/rejected | **< 3 hours** evening before; **< 30 min** morning-of (hypothesis) |
| Safety incidents | SOS + harassment + unsafe_driving counts | Absolute count; **any SOS** pages on-call |
| Safety resolution time | Ack -> resolve on admin incidents | **< 30 minutes** ack during commute hours (ops hypothesis) |

---

## 4. Value metrics (commercial fairness without settlement)

| Metric | Definition | Hypothesis |
|--------|------------|------------|
| Average passenger savings | Estimated fuel share accepted or estimated avoided solo cost proxy | Track **₹/ride**; target communication **₹40-120** typical (hypothesis - calibrate with distance) |
| Average driver fuel contribution | Accepted `ride_cost_shares.amount_paise` / completed host rides with share | Report distribution; do not force a target until estimate UX ships |
| Estimate vs accepted delta (once estimates exist) | | Watch for dispute signal if delta large |

Until estimates exist, mark savings metrics **unverified / qualitative**.

---

## 5. Trust metrics

| Metric | Definition | Hypothesis |
|--------|------------|------------|
| Verification badge coverage among active | Verified / WAC | **100%** of bookers by gate (should be enforced) |
| Rating coverage | Ratings / completed rides | **50%+** (hypothesis) |
| Avg host stars among matched | From `cleaner_city_reputation` | Informational; thin sample early |
| Block rate | Blocks / completed rides | Low single digits %; spike = safety issue |

---

## 6. Pilot operating dashboard (minimum)

Daily:

1. Publications tomorrow (count, seats)  
2. Open waitlist entries (once built)  
3. Requests pending > 2h  
4. Active rides now  
5. Open safety incidents  

Weekly:

1. WAC, completed rides, repeat rate  
2. Cancel / no-show  
3. Match empty-search rate  
4. Onboarding completion  
5. Top cancel reasons (add enum when Reliability Net ships)

---

## 7. Pilot success / fail hypotheses

**Declare soft success (hypothesis bar) if after 4 weeks:**

- >= 30 completed rides  
- >= 25 WAC  
- Booking-to-completed >= 65%  
- Empty-search rate on evenings-before weekday < 50%  
- Zero unresolved SOS > 24h  

**Declare product fail / pivot if:**

- Empty-search rate stays > 70% despite 50+ registered hosts (inventory/autopilot failure)  
- Completed < 10 rides (activation failure)  
- No-show + cancel-after-confirm > 40% (reliability failure)  
- Qualitative safety fear dominates interviews despite low incident count (trust packaging failure)

These bars are **hypotheses for a single-cluster pilot**, not company OKRs.

---

## 8. Instrumentation gaps to close before trusting numbers

Confirmed today:

- Core entities exist to count publications, rides, ratings, incidents, verifications  
- Admin stats RPC exists for pilot ops  

Missing / weak for accurate product analytics:

- Search impression and empty-result events (Find is client-side list; may need event log)  
- Onboarding step funnel events  
- No-show status not written yet - metric blocked until Reliability Net  
- Push delivery success for cleaner_city types not specially monitored  
- Savings estimate not computed  

Do not present board-level savings or no-show charts until those gaps close.

---

## 9. Research alongside metrics

Quantitative metrics will not answer:

- Why hosts refuse Autopilot  
- Gendered safety perception of work-email-only trust  
- Acceptable detour in specific corridors  
- Preference for Circles vs open neighbours  

Run 8-12 resident interviews in week 2 of pilot in parallel with the dashboard.
