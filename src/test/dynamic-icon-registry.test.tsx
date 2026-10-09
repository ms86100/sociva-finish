import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamicIcon } from '@/components/ui/DynamicIcon';

const lookupIcon = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/lucide-registry', () => ({
  lookupIcon,
}));

describe('DynamicIcon registry loading', () => {
  beforeEach(() => {
    lookupIcon.mockReset();
  });

  it('renders emoji names without importing the lucide registry', async () => {
    const emoji = '\u{1F372}';
    render(<DynamicIcon name={emoji} />);
    expect(screen.getByText(emoji)).toBeInTheDocument();
    await Promise.resolve();
    await Promise.resolve();
    expect(lookupIcon).not.toHaveBeenCalled();
  });

  it('loads the registry for a Lucide name and swaps off the Package fallback', async () => {
    lookupIcon.mockReturnValue(function ResolvedIcon() {
      return <svg data-testid="resolved-icon" />;
    });

    render(<DynamicIcon name="UtensilsCrossed" />);

    expect(await screen.findByTestId('resolved-icon')).toBeInTheDocument();
    expect(lookupIcon).toHaveBeenCalledWith('UtensilsCrossed');
  });
});
