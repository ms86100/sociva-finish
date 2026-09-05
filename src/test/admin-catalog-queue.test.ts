import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isApprovedLiveStore,
  isApplicationCatalogItem,
  pendingApplicationCatalogCount,
  splitPendingCatalogQueue,
} from '@/lib/admin-catalog-queue';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('admin catalog queue', () => {
  it('clubs first-time listings with the store application, not the live Products tab', () => {
    expect(isApplicationCatalogItem('pending')).toBe(true);
    expect(isApplicationCatalogItem('draft')).toBe(true);
    expect(isApplicationCatalogItem('rejected')).toBe(true);
    expect(isApplicationCatalogItem('approved')).toBe(false);
    expect(isApprovedLiveStore('approved')).toBe(true);
  });

  it('splits pending products so only live-store updates stay on the Products tab', () => {
    const { standalone, inApplication } = splitPendingCatalogQueue([
      { id: 'opening-dal', seller: { verification_status: 'pending' } },
      { id: 'opening-biryani', seller: { verification_status: 'draft' } },
      { id: 'later-edit', seller: { verification_status: 'approved' } },
      { id: 'orphan', seller: null },
    ]);

    expect(standalone.map((p) => p.id)).toEqual(['later-edit']);
    expect(inApplication.map((p) => p.id)).toEqual(['opening-dal', 'opening-biryani', 'orphan']);
  });

  it('counts opening catalog items that will go live with the store', () => {
    expect(pendingApplicationCatalogCount([
      { approval_status: 'pending' },
      { approval_status: 'draft' },
      { approval_status: 'approved' },
      { approval_status: 'rejected' },
    ])).toBe(2);
  });

  it('keeps application review as the first-time catalog surface', () => {
    const review = read('src/components/admin/SellerApplicationReview.tsx');
    const productsTab = read('src/components/admin/AdminProductApprovals.tsx');
    const approval = read('src/lib/seller-approval.ts');

    expect(review).toContain('ApplicationCatalogPreview');
    expect(review).toContain('Approve store &');
    expect(review).toContain('onSwitchToApplications');
    expect(review).not.toMatch(/prod\.approval_status === 'pending' && seller\.verification_status === 'approved'/);

    expect(productsTab).toContain('splitPendingCatalogQueue');
    expect(productsTab).toContain('Live Store Updates & New Products');
    expect(productsTab).toContain('Go to Store Applications');

    expect(approval).toContain(".in('approval_status', ['pending', 'draft'])");
    expect(approval).toContain('Club the opening catalog with this first-time approval');
  });

  it('fetches seller_id on application products so opening catalog can attach', () => {
    const hook = read('src/hooks/useSellerApplicationReview.ts');
    expect(hook).toMatch(/from\('products'\)\.select\('id, seller_id,/);
    expect(hook).toContain('productsBySeller[p.seller_id]');
  });
});
