import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('seller enquiry workflow action layout', () => {
  const page = readFileSync(resolve(__dirname, '../pages/OrderDetailPage.tsx'), 'utf8');

  it('stacks stage CTAs instead of forcing them onto one nowrap row', () => {
    expect(page).toMatch(/WORKFLOW_HERO_ACTIONS/);
    expect(page).toMatch(/WORKFLOW_BAR_INNER/);
    expect(page).toMatch(/flex flex-col gap-2/);
    expect(page).toMatch(/!whitespace-normal/);
    expect(page).toMatch(/pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  });

  it('keeps contact-enquiry labels and the full seller/buyer action bars', () => {
    expect(page).toMatch(/Accept Enquiry/);
    expect(page).toMatch(/Mark Delivered/);
    expect(page).toMatch(/hasSellerActionBar/);
    expect(page).toMatch(/hasBuyerActionBar/);
    expect(page).toMatch(/getActionLabel/);
  });
});
