import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLocalGuestBrowseHost } from '@/lib/guest-browse-routes';

const root = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('Phase 1.2 motion primitive adoption', () => {
  it('MotionList is consumed by buyer grid screens', () => {
    expect(read('components/home/MarketplaceSection.tsx')).toContain('MotionList');
    expect(read('pages/CommerceModePage.tsx')).toContain('MotionList');
    expect(read('pages/CategoryGroupPage.tsx')).toContain('MotionList');
    expect(read('pages/SearchPage.tsx')).toContain('MotionList');
  });

  it('MotionImage and MotionCard are consumed by ProductGridCard', () => {
    const card = read('components/product/ProductGridCard.tsx');
    expect(card).toContain('MotionImage');
    expect(card).toContain('MotionCard');
  });

  it('MotionImage guards cached-image shimmer flash', () => {
    const img = read('components/motion/MotionImage.tsx');
    expect(img).toMatch(/el\.complete/);
    expect(img).toMatch(/naturalWidth/);
  });

  it('MotionModal and MotionBottomSheet remain thin Radix/Vaul adapters', () => {
    const modal = read('components/motion/MotionModal.tsx');
    const sheet = read('components/motion/MotionBottomSheet.tsx');
    expect(modal).toContain("from '@/components/ui/dialog'");
    expect(sheet).toContain("from '@/components/ui/drawer'");
    expect(modal).toContain('export const MotionModal = Dialog');
    expect(sheet).toContain('export const MotionBottomSheet = Drawer');
  });

  it('ProductListingCard keeps specialized card motion (no forced MotionCard)', () => {
    const listing = read('components/product/ProductListingCard.tsx');
    expect(listing).not.toContain('MotionCard');
    expect(listing).toContain('cardEntrance');
  });
});

describe('Phase 1.2 localhost guest browse security', () => {
  it('loopback helper never matches production hostnames', () => {
    for (const host of ['sociva.in', 'www.sociva.in', 'vercel.app', 'example.com']) {
      expect(isLocalGuestBrowseHost(host), host).toBe(false);
    }
  });

  it('AppShellGate only skips marketing landing on loopback, not auth', () => {
    const gate = read('components/layout/AppShell.tsx').slice(
      read('components/layout/AppShell.tsx').indexOf('export function AppShellGate'),
    );
    expect(gate).toContain('isLocalGuestBrowseHost');
    expect(gate).toContain('Navigate to="/landing"');
    expect(gate).toContain('Navigate to="/auth"');
    expect(gate).toMatch(/if \(!guestOk\)/);
  });
});
