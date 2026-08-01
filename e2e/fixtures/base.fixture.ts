import { test as base, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * DB fixture: provides a Supabase client for deep assertions.
 * Uses anon key to also validate RLS policies.
 */
export type TestFixtures = {
  db: SupabaseClient;
};

export const test = base.extend<TestFixtures>({
  db: async ({}, use) => {
    const url = process.env.SUPABASE_URL || 'https://ywhlqsgvbkvcvqlsniad.supabase.co';
    const key = process.env.SUPABASE_ANON_KEY || '';
    const client = createClient(url, key);
    await use(client);
  },
});

export { expect } from '@playwright/test';
