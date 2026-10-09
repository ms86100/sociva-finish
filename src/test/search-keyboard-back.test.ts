import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { isJourneyBack } from '@/lib/search-journey';
import {
  handleSystemBackLayers,
  registerBackInterceptor,
  resetNavigationStackForTests,
} from '@/lib/navigation-stack';

const searchPageSource = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');

describe('search keyboard back', () => {
  beforeEach(() => {
    resetNavigationStackForTests();
  });

  it('focuses the search field once on open, not from a render callback ref', () => {
    expect(searchPageSource).not.toContain('setTimeout(() => el.focus()');
    expect(searchPageSource).not.toMatch(/ref=\{\(el\)/);
    expect(searchPageSource).toContain('useBackInterceptor(inputFocused');
    expect(searchPageSource).toContain('if (isJourneyBack(navigationType, location.state)) return undefined;');
    expect(searchPageSource).toMatch(/window\.setTimeout\(\(\) => inputRef\.current\?\.focus\(\), 280\)/);
  });

  it('does not autofocus when the user is returning to existing results', () => {
    expect(isJourneyBack('POP', null)).toBe(true);
    expect(isJourneyBack('REPLACE', { socivaBack: true })).toBe(true);
    expect(isJourneyBack('PUSH', null)).toBe(false);
    expect(isJourneyBack('REPLACE', null)).toBe(false);
  });

  it('lets a focused search field consume Back before the route changes', () => {
    let dismissed = false;
    const stop = registerBackInterceptor('page', () => {
      dismissed = true;
      return true;
    });
    expect(handleSystemBackLayers()).toBe(true);
    expect(dismissed).toBe(true);
    stop();
    expect(handleSystemBackLayers()).toBe(false);
  });

  it('still closes an open product sheet before dismissing the search field', () => {
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    let dismissedField = false;
    const stop = registerBackInterceptor('page', () => {
      dismissedField = true;
      return true;
    });
    const previous = document.dispatchEvent;
    let escapeFired = false;
    document.dispatchEvent = ((event: Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') escapeFired = true;
      return true;
    }) as typeof document.dispatchEvent;

    expect(handleSystemBackLayers()).toBe(true);
    expect(escapeFired).toBe(true);
    expect(dismissedField).toBe(false);

    document.dispatchEvent = previous;
    document.body.innerHTML = '';
    stop();
  });
});
