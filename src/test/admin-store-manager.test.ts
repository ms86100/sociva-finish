import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { adminStorePaths, SELLER_STORE_PATHS } from '@/contexts/AdminManagedSellerContext';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('admin store manager', () => {
  const migration = read('supabase/migrations/20260913190000_admin_store_manager_product_rpc_bypass.sql');
  const productsHook = read('src/hooks/useSellerProducts.ts');
  const settingsHook = read('src/hooks/useSellerSettings.ts');
  const app = read('src/App.tsx');
  const nav = read('src/components/admin/AdminSidebarNav.tsx');
  const store360 = read('src/components/admin/command-center/CommandCenterStore360Sheet.tsx');
  const hub = read('src/pages/AdminStoreManagerPage.tsx');

  it('patches product RPCs and products INSERT for is_admin', () => {
    expect(migration).toMatch(/save_product_with_service/);
    expect(migration).toMatch(/update_product_with_service/);
    expect(migration).toMatch(/NOT public\.is_admin\(auth\.uid\(\)\)/);
    expect(migration).toMatch(/FOR INSERT/);
    expect(migration).toMatch(/OR public\.is_admin\(auth\.uid\(\)\)/);
  });

  it('wires admin store manager routes and navigation', () => {
    expect(app).toMatch(/path="\/admin\/stores"/);
    expect(app).toMatch(/path="\/admin\/stores\/:sellerId"/);
    expect(app).toMatch(/path="\/admin\/stores\/:sellerId\/products"/);
    expect(app).toMatch(/path="\/admin\/stores\/:sellerId\/settings"/);
    expect(app).toMatch(/AdminManagedSellerProvider/);
    expect(nav).toMatch(/store-manager/);
    expect(nav).toMatch(/\/admin\/stores/);
  });

  it('parameterizes seller hooks with admin-only override', () => {
    expect(productsHook).toMatch(/sellerIdOverride/);
    expect(productsHook).toMatch(/isAdmin && sellerIdOverride/);
    expect(settingsHook).toMatch(/sellerIdOverride/);
    expect(settingsHook).toMatch(/isAdmin && sellerIdOverride/);
  });

  it('exposes Manage store CTA from Store 360', () => {
    expect(store360).toMatch(/Manage store/);
    expect(store360).toMatch(/\/admin\/stores\/\$\{sellerId\}/);
  });

  it('hub uses search picker and section cards', () => {
    expect(hub).toMatch(/AdminStoreSearchPicker/);
    expect(hub).toMatch(/Products \/ listings/);
    expect(hub).toMatch(/Store settings/);
    expect(hub).toMatch(/Audit snapshot/);
  });

  it('adminStorePaths nests under /admin/stores without changing seller paths', () => {
    const paths = adminStorePaths('abc-seller');
    expect(paths.products).toBe('/admin/stores/abc-seller/products');
    expect(paths.settings).toBe('/admin/stores/abc-seller/settings');
    expect(paths.productEdit('p1')).toBe('/admin/stores/abc-seller/products/p1/edit');
    expect(SELLER_STORE_PATHS.products).toBe('/seller/products');
    expect(SELLER_STORE_PATHS.settings).toBe('/seller/settings');
  });
});
