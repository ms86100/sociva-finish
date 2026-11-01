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
    expect(card).toHaveTextContent('A Cleaner City');
    expect(card).toHaveTextContent('Verified commuters');
    expect(card).toHaveTextContent('Smart route matching');
  });
});

describe('A Cleaner City does not hijack Book commerce mode', () => {
  it('keeps cab contact_enquiry on services mode', () => {
    expect(modeForAction('contact_seller')).toBe('services');
  });

  it('CommerceModePage still wires Book tiles separately from cleaner-city route', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/CommerceModePage.tsx'), 'utf8');
    expect(page).toContain('CleanerCityEntryCard');
    expect(page).toContain('buildGuidedDiscoveryTiles');
    expect(page).not.toContain("category: 'cleaner_city'");
  });
});
