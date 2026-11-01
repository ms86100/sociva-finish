# Unit 3 exit gate

## Shipped

- Per-weekday template upsert (`cleaner_city_set_commute_template`) - one weekday only
- Per-date override upsert/clear (`cleaner_city_set_commute_override`, `cleaner_city_clear_commute_override`)
- Pause/resume (`cleaner_city_pause_commute`)
- Timezone column + setter (`cleaner_city_set_timezone`)
- Effective schedule resolver: pause > override > template (`cleaner_city_effective_schedule`)
- UI: `/cleaner-city/schedule`
- Hub link with today's effective summary

## Exit criteria

- Saving Monday does not rewrite Tuesday
- Saving a date override does not rewrite weekly templates or other dates
- WFH/leave/holiday default to not commuting
- Paused profiles report `source=paused` and `is_working=false`
