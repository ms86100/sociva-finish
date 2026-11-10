import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261110180000_cleaner_city_open_company_domains.sql'),
  'utf8',
);
const titlecase = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261110190000_cleaner_city_company_name_titlecase.sql'),
  'utf8',
);

describe('open company domains for work email', () => {
  it('derives company slug from domain and auto-approves non-personal domains', () => {
    expect(migration).toContain('cleaner_city_company_name_from_domain');
    expect(migration).toContain('cleaner_city_ensure_company_domain');
    expect(migration).toContain("status = 'approved'");
    expect(migration).toContain('Auto-approved from work email');
    expect(migration).not.toContain('domain_not_approved');
  });

  it('title-cases derived company names for display', () => {
    expect(titlecase).toContain('upper(substring(v_slug from 1 for 1))');
    expect(titlecase).toContain('Sociva');
  });
});
