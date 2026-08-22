import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SellerDashboardLoadingState } from '@/components/seller/SellerDashboardLoadingState';

describe('seller dashboard store-switch loading state', () => {
  it('keeps the destination store visible while its dashboard reloads', () => {
    render(<SellerDashboardLoadingState storeName="E2E Bookable Studio S2" />);

    const status = screen.getByRole('status', {
      name: 'Switching to E2E Bookable Studio S2',
    });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Switching store')).toBeVisible();
    expect(screen.getByText('E2E Bookable Studio S2')).toBeVisible();
  });
});

describe('seller dashboard StoreStatusCard wiring', () => {
  it('imports StoreStatusCard before rendering it', () => {
    const source = readFileSync(join(process.cwd(), 'src/pages/SellerDashboardPage.tsx'), 'utf8');
    expect(source).toMatch(/import \{ StoreStatusCard \} from '@\/components\/seller\/StoreStatusCard'/);
    expect(source).toContain('<StoreStatusCard');
  });
});
