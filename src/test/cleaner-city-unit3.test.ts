import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102120000_cleaner_city_unit3_schedules.sql'),
  'utf8',
);
const schedulePage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCitySchedulePage.tsx'),
  'utf8',
);
const hooks = fs.readFileSync(
  path.resolve(process.cwd(), 'src/hooks/queries/useCleanerCity.ts'),
  'utf8',
);

describe('A Cleaner City Unit 3 schedule contracts', () => {
  it('upserts one weekday without rewriting other days', () => {
    expect(migration).toContain('ON CONFLICT (user_id, weekday) DO UPDATE');
    expect(migration).toContain('Never touches other weekdays');
    // Leave times UI saves the week via per-weekday template upserts.
    expect(schedulePage).toContain('Save commute');
    expect(schedulePage).toContain('useSetCommuteTemplate');
    expect(hooks).toContain('cleaner_city_set_commute_template');
  });

  it('date overrides never mutate weekly templates', () => {
    expect(migration).toContain('ON CONFLICT (user_id, override_date) DO UPDATE');
    expect(migration).toContain('Never rewrites other dates or weekly templates');
    expect(hooks).toContain('cleaner_city_set_commute_override');
    expect(hooks).toContain('cleaner_city_mark_wfh');
  });

  it('effective schedule prefers pause then override then template', () => {
    expect(migration).toContain("source', 'paused'");
    expect(migration).toContain("source', 'override'");
    expect(migration).toContain("source', 'template'");
    expect(hooks).toContain('cleaner_city_effective_schedule');
  });

  it('supports WFH/leave/holiday override kinds and pause', () => {
    expect(migration).toContain("'time_change', 'wfh', 'leave', 'holiday', 'custom'");
    expect(migration).toContain('cleaner_city_pause_commute');
    expect(hooks).toContain('cleaner_city_pause_commute');
    const constants = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/cleaner-city/constants.ts'),
      'utf8',
    );
    expect(constants).toContain("label: 'Working from home'");
  });
});
