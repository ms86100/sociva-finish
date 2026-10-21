import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_SOCIVA_VOICE_SOCIETY,
  isValidIndianMobile,
  normalizeIndianPhone,
  validateSocivaVoiceLead,
} from '@/lib/sociva-voice-lead';

const root = process.cwd();

function readSrc(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Talk to Sociva lead validation', () => {
  it('normalizes +91 and leading zero to a 10-digit mobile', () => {
    expect(normalizeIndianPhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianPhone('09876543210')).toBe('9876543210');
    expect(normalizeIndianPhone('9876543210')).toBe('9876543210');
  });

  it('accepts valid Indian mobiles starting 6-9', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('6123456789')).toBe(true);
    expect(isValidIndianMobile('5123456789')).toBe(false);
    expect(isValidIndianMobile('987654321')).toBe(false);
  });

  it('requires name, phone, and society', () => {
    expect(validateSocivaVoiceLead({ full_name: 'A', phone: '9876543210', society_name: 'Green Park' }).ok).toBe(false);
    expect(validateSocivaVoiceLead({ full_name: 'Anjali', phone: '123', society_name: 'Green Park' }).ok).toBe(false);
    expect(validateSocivaVoiceLead({ full_name: 'Anjali', phone: '9876543210', society_name: '' }).ok).toBe(false);
    const ok = validateSocivaVoiceLead({
      full_name: '  Anjali Sharma  ',
      phone: '+919876543210',
      society_name: ' Green Park ',
    });
    expect(ok.ok).toBe(true);
    expect(ok.value).toEqual({
      full_name: 'Anjali Sharma',
      phone: '9876543210',
      society_name: 'Green Park',
    });
  });
});

describe('Talk to Sociva product wiring', () => {
  it('invites English, Hindi, or Kannada and does not say Hinglish', () => {
    const page = readSrc('src/pages/TalkToSocivaPage.tsx');
    const call = readSrc('src/components/seller/SocivaVoiceCall.tsx');
    expect(page).toMatch(/English, Hindi, or Kannada/);
    expect(call).toMatch(/English, Hindi, or Kannada/);
    expect(page).not.toMatch(/Hinglish/);
    expect(call).not.toMatch(/Hinglish/);
  });

  it('pre-fills society as Shriram Greenfield', () => {
    expect(DEFAULT_SOCIVA_VOICE_SOCIETY).toBe('Shriram Greenfield');
    expect(readSrc('src/pages/TalkToSocivaPage.tsx')).toContain('useState(DEFAULT_SOCIVA_VOICE_SOCIETY)');
  });

  it('registers the public and admin routes', () => {
    const app = readSrc('src/App.tsx');
    expect(app).toContain('path="/talk-to-sociva"');
    expect(app).toContain('path="/admin/seller-interest"');
    expect(app).toContain('TalkToSocivaPage');
    expect(app).toContain('AdminSellerInterestPage');
  });

  it('does not brand the assistant as Riya and does not ship Retell secrets', () => {
    const files = [
      'src/pages/TalkToSocivaPage.tsx',
      'src/components/seller/SocivaVoiceCall.tsx',
      'src/hooks/useSocivaVoiceCall.ts',
      'src/pages/AdminSellerInterestPage.tsx',
      'supabase/functions/start-sociva-voice-call/index.ts',
      'supabase/functions/get-sociva-voice-call/index.ts',
    ];
    for (const file of files) {
      const src = readSrc(file);
      expect(src, file).not.toMatch(/Riya/);
      expect(src, file).not.toMatch(/agent\.retellai\.com/);
      expect(src, file).not.toMatch(/f11fb1952da8157b024f076f3f50f03e/);
    }
    const frontend = [
      'src/pages/TalkToSocivaPage.tsx',
      'src/components/seller/SocivaVoiceCall.tsx',
      'src/hooks/useSocivaVoiceCall.ts',
      'src/pages/AdminSellerInterestPage.tsx',
    ];
    for (const file of frontend) {
      const src = readSrc(file);
      expect(src, file).not.toMatch(/RETELL_API_KEY/);
      expect(src, file).not.toMatch(/VITE_RETELL/);
    }
  });

  it('starts calls from a public Edge Function and reads history from Retell', () => {
    const start = readSrc('supabase/functions/start-sociva-voice-call/index.ts');
    expect(start).toContain('createRetellWebCall');
    expect(start).toContain('seller_interest_leads');
    expect(start).toContain('MAX_PER_PHONE_PER_HOUR');
    expect(start).toContain('ice_servers');
    expect(start).toContain('transport');
    expect(start).not.toContain('seller_profiles');
    expect(start).not.toContain('from("products")');

    const hook = readSrc('src/hooks/useSocivaVoiceCall.ts');
    expect(hook).toContain('functionInvokeErrorMessage');
    expect(hook).toContain('askForMicrophone');
    expect(hook).toContain('callId: data.call_id');
    expect(hook).toContain('iceServers');

    const getCall = readSrc('supabase/functions/get-sociva-voice-call/index.ts');
    expect(getCall).toContain('withAdmin');
    expect(getCall).toContain('getRetellCall');
    expect(getCall).toContain('pickRetellCallForAdmin');
  });

  it('keeps the capture table thin', () => {
    const sql = readSrc('supabase/migrations/20261021180000_seller_interest_leads.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.seller_interest_leads');
    expect(sql).toContain('retell_call_id');
    expect(sql).not.toMatch(/\btranscript\b/);
    expect(sql).not.toMatch(/\brecording_url\b/);
    expect(sql).not.toMatch(/\bofferings?\b/);
    expect(sql).toContain('is_admin(auth.uid())');
  });
});
