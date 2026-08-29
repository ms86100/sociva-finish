import { describe, expect, it } from 'vitest';
import { drawerKeyboardLiftPx } from '@/hooks/useChatViewport';

describe('drawerKeyboardLiftPx', () => {
  it('does not lift when Capacitor already shrank the WebView', () => {
    expect(drawerKeyboardLiftPx({
      baselineInnerHeight: 800,
      innerHeight: 480,
      visualKeyboardHeight: 0,
      nativeKeyboardHeight: 320,
    })).toBe(0);
  });

  it('lifts by the visual overlap when the keyboard overlays the layout', () => {
    expect(drawerKeyboardLiftPx({
      baselineInnerHeight: 800,
      innerHeight: 800,
      visualKeyboardHeight: 320,
      nativeKeyboardHeight: 320,
    })).toBe(320);
  });

  it('falls back to native height when visualViewport does not report overlap', () => {
    expect(drawerKeyboardLiftPx({
      baselineInnerHeight: 800,
      innerHeight: 800,
      visualKeyboardHeight: 0,
      nativeKeyboardHeight: 300,
    })).toBe(300);
  });

  it('does not lift when the keyboard is closed', () => {
    expect(drawerKeyboardLiftPx({
      baselineInnerHeight: 800,
      innerHeight: 800,
      visualKeyboardHeight: 0,
      nativeKeyboardHeight: 0,
    })).toBe(0);
  });
});
