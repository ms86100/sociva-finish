import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sociva Core package', () => {
  it('does not keep gate ops on the default package', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261123280000_core_package_no_ops_features.sql'),
      'utf8',
    );
    expect(sql).toMatch(/visitor_management/);
    expect(sql).toMatch(/vehicle_parking/);
    expect(sql).toMatch(/fp\.is_default = true/);
  });
});
