import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ScrollRestoration } from '@/components/navigation/ScrollRestoration';
import { resetNavigationStackForTests } from '@/lib/navigation-stack';

let navigateRef: ReturnType<typeof useNavigate> | null = null;

function NavigateCapture() {
  navigateRef = useNavigate();
  return null;
}

function makeScrollRoot() {
  const root = document.createElement('div');
  root.id = 'root';
  let top = 0;
  Object.defineProperty(root, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = value; },
  });
  document.body.appendChild(root);
  return root;
}

describe('ScrollRestoration', () => {
  let root: HTMLElement;

  beforeEach(() => {
    resetNavigationStackForTests();
    root = makeScrollRoot();
  });

  afterEach(() => {
    root.remove();
    navigateRef = null;
  });

  it('resets #root on push and restores it on back', () => {
    render(
      <MemoryRouter initialEntries={['/list']}>
        <ScrollRestoration />
        <NavigateCapture />
      </MemoryRouter>,
    );

    root.scrollTop = 640;
    act(() => navigateRef!('/product/1'));
    expect(root.scrollTop).toBe(0);

    root.scrollTop = 120;
    act(() => navigateRef!(-1));
    expect(root.scrollTop).toBe(640);
  });
});
