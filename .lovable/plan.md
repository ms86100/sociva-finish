# Event-driven reminder system

Replace the every-5-min `notification-engine` scan-everything cron with **per-order scheduled reminders** that are inserted by a DB trigger when status changes, and canceled the moment the order moves on. A tiny cron only touches rows that are actually due.

## Result
- Idle ticks do near-zero work (1 indexed lookup, 0 rows).
- No edge function hop, no `notification_engine_runs` audit spam.
- Reminders fire on time (±1 min) with the same rules / dedupe / queue as today.

---

## Step 1 — New table

`scheduled_reminders`
- `entity_type` (`order` | `delivery`)
- `entity_id` uuid
- `rule_id` uuid → `notification_rules`
- `fire_at` timestamptz
- `fired_at`, `canceled_at` timestamptz (nullable)
- unique (`entity_id`, `rule_id`)
- partial index on `fire_at` where `fired_at IS NULL AND canceled_at IS NULL`

## Step 2 — Schedule on status change

Trigger on `orders` (AFTER INSERT OR UPDATE OF status):
1. `UPDATE scheduled_reminders SET canceled_at = now()` for that order where not yet fired/canceled.
2. For every active `notification_rules` row where `entity_type='order' AND trigger_status = NEW.status`, insert a row with `fire_at = NEW.status_changed_at + delay_seconds`. Use `ON CONFLICT DO NOTHING` for safety.

Same pattern on `delivery_assignments` (AFTER INSERT OR UPDATE OF stall_level), mapping `stall_1` / `stall_2`.

## Step 3 — Fire due reminders

SQL function `fn_fire_due_reminders(batch int default 200)`:
- `SELECT ... FROM scheduled_reminders WHERE fire_at <= now() AND fired_at IS NULL AND canceled_at IS NULL ORDER BY fire_at LIMIT batch FOR UPDATE SKIP LOCKED`
- For each: resolve target user (buyer_id directly, or seller_profiles.user_id via seller_id), call existing `fn_enqueue_from_rule(...)`, then set `fired_at = now()`.
- Return count enqueued.

`pg_cron` every 1 minute calls this function. If count > 0, `pg_net` posts to `process-notification-queue` to deliver immediately.

## Step 4 — Decommission old engine

- `cron.unschedule(9)` (notification_engine_every_1m).
- Delete the `notification-engine` edge function.
- Keep `notification_engine_runs` table (history); stop writing to it.

## Step 5 — Backfill

One-off SQL to seed `scheduled_reminders` for currently-open orders so nothing in flight is lost:
- For every order in `placed/accepted/preparing/ready`, run the same insert logic the trigger does, using existing `status_changed_at`. Rows already past `fire_at` will be picked up by the first cron tick.

---

## Technical notes
- `fn_enqueue_from_rule` already handles dedupe via `notification_state_tracker` + `dedupe_key`, so reposted reminders after a status flip-flop won't double-send.
- Repeat-style rules (`repeat_interval_seconds`, `max_repeats`) are not currently used by any active rule, so we don't need to model recurrence yet — when needed, the fire function can re-insert a follow-up row with `fire_at = now() + repeat_interval_seconds`.
- The cron uses `SKIP LOCKED`, so multiple workers are safe.
- Worst-case latency: ~60s after `fire_at`. Same as today.

## Files touched
- 1 migration (table, indexes, triggers, fire function, cron swap, backfill).
- Delete `supabase/functions/notification-engine/` and call `supabase--delete_edge_functions`.

Approve and I'll ship the migration, then remove the edge function in the same change.
