/**
 * Hard env binding for native/web builds.
 * Staging builds refuse to fall back to production Supabase.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { capacitorStorage } from '@/lib/capacitor-storage';

const PROD_REF = 'kkzkuyhgdvyecmxtmkpy';
const STAGING_REF = 'wwuanzbusxoyzixuprxs';

// Prefer VITE_* when present; production builds may fall back to live defaults.
// Staging builds NEVER fall back - missing/wrong env fails the app at boot.
const LIVE_SUPABASE_URL = `https://${PROD_REF}.supabase.co`;
const LIVE_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA';

const rawEnvUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.replace(/^["']|["']$/g, '')
  .trim();
const rawEnvKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
  ?.replace(/^["']|["']$/g, '')
  .trim();

// VITE_APP_ENV is set by Codemagic (staging vs production). CAPACITOR_ENV is
// Node-only unless mirrored; do not rely on it inside the Vite bundle.
const appEnv = String(import.meta.env.VITE_APP_ENV || '')
  .toLowerCase()
  .trim();

const isDefunctUrl = (url: string) =>
  url.includes('ywhlqsgvbkvcvqlsniad') || url.includes('wyljabsdluxvcjiztmez');

const isStagingBuild = appEnv === 'staging' || appEnv === 'test';

function resolveUrl(): string {
  if (isStagingBuild) {
    if (!rawEnvUrl || isDefunctUrl(rawEnvUrl)) {
      throw new Error(
        `[Supabase] Staging build missing VITE_SUPABASE_URL (expected ${STAGING_REF})`,
      );
    }
    if (rawEnvUrl.includes(PROD_REF)) {
      throw new Error(
        '[Supabase] Staging build refused to connect to PRODUCTION Supabase',
      );
    }
    if (!rawEnvUrl.includes(STAGING_REF)) {
      throw new Error(
        `[Supabase] Staging build URL must include ${STAGING_REF}. Got: ${rawEnvUrl}`,
      );
    }
    return rawEnvUrl;
  }

  if (rawEnvUrl && !isDefunctUrl(rawEnvUrl)) {
    if (rawEnvUrl.includes(STAGING_REF) && appEnv === 'production') {
      throw new Error(
        '[Supabase] Production build refused to connect to STAGING Supabase',
      );
    }
    return rawEnvUrl;
  }
  return LIVE_SUPABASE_URL;
}

function resolveKey(url: string): string {
  if (isStagingBuild) {
    if (!rawEnvKey) {
      throw new Error('[Supabase] Staging build missing VITE_SUPABASE_PUBLISHABLE_KEY');
    }
    return rawEnvKey;
  }
  if (rawEnvKey && url === rawEnvUrl) return rawEnvKey;
  return LIVE_SUPABASE_KEY;
}

export const SUPABASE_URL = resolveUrl();
export const SUPABASE_PUBLISHABLE_KEY = resolveKey(SUPABASE_URL);
export const APP_ENV = isStagingBuild ? 'staging' : 'production';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: capacitorStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

if (typeof console !== 'undefined') {
  console.info(
    `[Supabase] env=${APP_ENV} host=${SUPABASE_URL.replace(/^https?:\/\//, '').split('/')[0]}`,
  );
}
