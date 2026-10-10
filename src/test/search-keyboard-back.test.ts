import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { isJourneyBack } from '@/lib/search-journey';
import {
  handleInAppBackLayers,
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
    expect(searchPageSource).toContain('if (isJourneyBack(navigationType, location.state)) return undefined;');
    expect(searchPageSource).toMatch(/window\.setTimeout\(\(\) => inputRef\.current\?\.focus\(\), 280\)/);
  });

  it('only holds Back while the keyboard is actually up, not just while the field is focused', () => {
    expect(searchPageSource).toContain('useBackInterceptor(inputFocused && keyboard.isKeyboardOpen');
    expect(searchPageSource).toMatch(/wasOpen && !keyboard\.isKeyboardOpen && document\.activeElement === inputRef\.current/);
  });

  it('keeps the keyboard up for filter, sort, and chip taps', () => {
    expect(searchPageSource).toContain('isTypingTarget(event.target) || isKeepKeyboardTarget(event.target)');
    expect(searchPageSource.match(/data-keep-keyboard>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
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

  it.each([
    ['alert dialog', '<div role="alertdialog" data-state="open"></div>'],
    ['select list', '<div role="listbox" data-state="open"></div>'],
  ])('Back closes an open %s before changing the route', (_label, html) => {
    document.body.innerHTML = html;
    const previous = document.dispatchEvent;
    let escapeFired = false;
    document.dispatchEvent = ((event: Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') escapeFired = true;
      return true;
    }) as typeof document.dispatchEvent;

    expect(handleSystemBackLayers()).toBe(true);
    expect(escapeFired).toBe(true);

    document.dispatchEvent = previous;
    document.body.innerHTML = '';
  });

  it('on-screen arrow skips the search keyboard step but hardware Back does not', () => {
    let dismissed = 0;
    const stop = registerBackInterceptor('page', () => {
      dismissed += 1;
      return true;
    }, { systemOnly: true });

    expect(handleInAppBackLayers()).toBe(false);
    expect(dismissed).toBe(0);
    expect(handleSystemBackLayers()).toBe(true);
    expect(dismissed).toBe(1);
    stop();
  });

  it('on-screen arrow still steps back through wizard interceptors', () => {
    let stepped = false;
    const stop = registerBackInterceptor('page', () => {
      stepped = true;
      return true;
    });
    expect(handleInAppBackLayers()).toBe(true);
    expect(stepped).toBe(true);
    stop();
  });

  it('search registers its keyboard interceptor as system-only', () => {
    expect(searchPageSource).toMatch(/useBackInterceptor\(inputFocused && keyboard\.isKeyboardOpen[\s\S]*?'page', \{ systemOnly: true \}\)/);
  });

  it('ignores closed alert dialogs and select lists', () => {
    document.body.innerHTML = '<div role="alertdialog" data-state="closed"></div><div role="listbox" data-state="closed"></div>';
    expect(handleSystemBackLayers()).toBe(false);
    document.body.innerHTML = '';
  });
});
