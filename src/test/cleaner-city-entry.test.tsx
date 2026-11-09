import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modeForAction } from '@/lib/commerce-mode';

const featureState = vi.hoisted(() => ({
  enabled: false,
  loading: false,
}));

vi.mock('@/hooks/useEffectiveFeatures', () => ({
  useEffectiveFeatures: () => ({
    isFeatureEnabled: (key: string) => key === 'cleaner_city' && featureState.enabled,
    isLoading: featureState.loading,
    isError: false,
  }),
}));

vi.mock('@/hooks/queries/useCleanerCity', () => ({
  useMyRides: () => ({ data: [] }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

import { CleanerCityEntryCard } from '@/components/cleaner-city/CleanerCityEntryCard';

describe('CleanerCityEntryCard', () => {
  beforeEach(() => {
    featureState.enabled = false;
    featureState.loading = false;
  });

  it('hides when cleaner_city feature is disabled', () => {
    render(
      <MemoryRouter>
        <CleanerCityEntryCard />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('cleaner-city-entry-card')).toBeNull();
  });

  it('shows branded entry when feature is enabled', () => {
    featureState.enabled = true;
    render(
      <MemoryRouter>
        <CleanerCityEntryCard />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('cleaner-city-entry-card');
    expect(card).toHaveAttribute('href', '/cleaner-city');
    expect(card).toHaveTextContent('sociva cleaner city');
    expect(card).toHaveTextContent('Find a ride');
    expect(card).toHaveTextContent('Offer a seat');
  });

  it('entry card can deep-link into a live mission when rides are active', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/cleaner-city/CleanerCityEntryCard.tsx'),
      'utf8',
    );
    expect(src).toContain('useMyRides');
    expect(src).toContain('Live mission');
    expect(src).toContain('/cleaner-city/ride/');
  });
});

describe('A Cleaner City does not hijack Book commerce mode', () => {
  it('keeps cab contact_enquiry on services mode', () => {
    expect(modeForAction('contact_seller')).toBe('services');
  });

  it('CommerceModePage keeps Book tiles and does not mount cleaner-city entry', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/CommerceModePage.tsx'), 'utf8');
    expect(page).not.toContain('CleanerCityEntryCard');
    expect(page).toContain('buildGuidedDiscoveryTiles');
    expect(page).not.toContain("category: 'cleaner_city'");
  });
});
