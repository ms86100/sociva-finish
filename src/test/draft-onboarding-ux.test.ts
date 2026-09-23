import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildArchivedDraftName,
  draftProgressPercent,
  isIncompleteDraftStore,
  listIncompleteDraftStores,
  onboardingStepLabel,
  resolveSameGroupStore,
  shouldGateNewStoreOnboarding,
  stoppedAtLabel,
} from '@/lib/onboarding-state';

const root = process.cwd();

function readSrc(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('draft onboarding UX helpers', () => {
  it('maps wizard steps to seller-friendly labels', () => {
    expect(onboardingStepLabel(1)).toBe('What would you like to sell?');
    expect(onboardingStepLabel(2)).toBe('Pick a subcategory');
    expect(onboardingStepLabel(3)).toBe('Add listing details');
    expect(onboardingStepLabel(4)).toBe('Name your store and submit');
    expect(onboardingStepLabel(99)).toBe('Name your store and submit');
  });

  it('computes progress percent from saved step (1→0%, 4→100%)', () => {
    expect(draftProgressPercent(1)).toBe(0);
    expect(draftProgressPercent(2)).toBe(33);
    expect(draftProgressPercent(3)).toBe(67);
    expect(draftProgressPercent(4)).toBe(100);
    expect(draftProgressPercent(undefined)).toBe(0);
  });

  it('stoppedAtLabel uses onboarding meta step', () => {
    expect(stoppedAtLabel({ step: 3 })).toBe('Add listing details');
    expect(stoppedAtLabel(null)).toBe('What would you like to sell?');
  });

  it('buildArchivedDraftName prefixes once', () => {
    expect(buildArchivedDraftName('Untitled store')).toBe('[ARCHIVED] Untitled store');
    expect(buildArchivedDraftName('QA Kitchen')).toBe('[ARCHIVED] QA Kitchen');
    expect(buildArchivedDraftName('[ARCHIVED] Already')).toBe('[ARCHIVED] Already');
    expect(buildArchivedDraftName('')).toBe('[ARCHIVED] Untitled store');
  });

  it('isIncompleteDraftStore ignores approved, rejected, and shelved names', () => {
    expect(isIncompleteDraftStore({
      business_name: 'Untitled store',
      verification_status: 'draft',
    })).toBe(true);
    expect(isIncompleteDraftStore({
      business_name: 'Live',
      verification_status: 'approved',
    })).toBe(false);
    expect(isIncompleteDraftStore({
      business_name: '[ARCHIVED] Untitled store',
      verification_status: 'draft',
    })).toBe(false);
    expect(isIncompleteDraftStore({
      business_name: '[HOLD] Old',
      verification_status: 'draft',
    })).toBe(false);
  });

  it('gates new store when any incomplete draft exists', () => {
    const stores = [
      { id: 'a', business_name: 'Yoga', verification_status: 'approved' },
      { id: 'b', business_name: 'Untitled store', verification_status: 'draft' },
    ];
    expect(shouldGateNewStoreOnboarding(stores)).toBe(true);
    expect(listIncompleteDraftStores(stores)).toHaveLength(1);
    expect(shouldGateNewStoreOnboarding([
      { id: 'a', business_name: 'Yoga', verification_status: 'approved' },
      { id: 'x', business_name: '[ARCHIVED] Old', verification_status: 'rejected' },
    ])).toBe(false);
  });
});

describe('resolveSameGroupStore skips shelved drafts', () => {
  it('allows create when only shelved row shares the group', () => {
    expect(resolveSameGroupStore([
      {
        id: 'arch',
        primary_group: 'yoga',
        verification_status: 'rejected',
        business_name: '[ARCHIVED] Untitled store',
      },
    ], 'yoga', null)).toEqual({ action: 'create' });
  });

  it('still adopts a live draft in the same group', () => {
    expect(resolveSameGroupStore([
      {
        id: 'd1',
        primary_group: 'yoga',
        verification_status: 'draft',
        business_name: 'Untitled store',
      },
    ], 'yoga', null)).toEqual({
      action: 'adopt-draft',
      id: 'd1',
      businessName: 'Untitled store',
    });
  });
});

describe('draft onboarding UX wiring', () => {
  it('hook exposes rename, delete, and gated start APIs', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('renameDraftStore');
    expect(src).toContain('deleteDraftStore');
    expect(src).toContain('requestStartNewStoreOnboarding');
    expect(src).toContain('buildArchivedDraftName');
    expect(src).toContain("primary_group: null");
  });

  it('panel shows Continue Setup, Rename, Delete Draft', () => {
    const src = readSrc('src/components/seller/ExistingStoresOnboardingPanel.tsx');
    expect(src).toContain('Continue Setup');
    expect(src).toContain('Delete Draft');
    expect(src).toContain('Rename');
    expect(src).toContain('You stopped at:');
    expect(src).toContain('You already have a store setup in progress');
  });

  it('BecomeSellerPage wires welcome back and draft actions', () => {
    const src = readSrc('src/pages/BecomeSellerPage.tsx');
    expect(src).toContain('Welcome back!');
    expect(src).toContain('handleResumeDraft');
    expect(src).toContain('onRenameDraft={renameDraftStore}');
    expect(src).toContain('onDeleteDraft={deleteDraftStore}');
    expect(src).toContain('handleRequestAddNewStore');
  });
});
