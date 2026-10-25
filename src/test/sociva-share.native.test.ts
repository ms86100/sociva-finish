import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ on: false }));
const shareMock = vi.hoisted(() => ({ share: vi.fn() }));
const clipboardMock = vi.hoisted(() => ({ write: vi.fn() }));
const browserMock = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
    getPlatform: () => (native.on ? 'android' : 'web'),
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: (...args: unknown[]) => shareMock.share(...args),
  },
}));

vi.mock('@capacitor/clipboard', () => ({
  Clipboard: {
    write: (...args: unknown[]) => clipboardMock.write(...args),
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: (...args: unknown[]) => browserMock.open(...args),
  },
}));

import { shareBridge, shareSocivaContent } from '@/lib/sociva-share';

const payload = {
  title: 'Chicken Biryani',
  text: 'Found this on Sociva!\nChicken Biryani - ₹199\nhttps://www.sociva.in/api/share/product/abc?og=1',
  url: 'https://www.sociva.in/api/share/product/abc?og=1',
};

function decodeSchemeText(url: string): string {
  expect(url.startsWith('whatsapp://send?text=')).toBe(true);
  return decodeURIComponent(url.slice('whatsapp://send?text='.length));
}

describe('shareSocivaContent native', () => {
  beforeEach(() => {
    native.on = true;
    shareMock.share.mockReset();
    clipboardMock.write.mockReset();
    browserMock.open.mockReset();
    shareMock.share.mockResolvedValue(undefined);
    clipboardMock.write.mockRejectedValue(new Error('clipboard unavailable'));
    browserMock.open.mockResolvedValue(undefined);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens WhatsApp with the prefilled message via the native scheme, not the in-app browser', async () => {
    const assign = vi.spyOn(shareBridge, 'assignLocation').mockImplementation(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const result = await shareSocivaContent(payload);

    expect(result).toBe('whatsapp');
    expect(decodeSchemeText(String(assign.mock.calls[0]?.[0]))).toBe(payload.text);
    expect(shareMock.share).not.toHaveBeenCalled();
    expect(browserMock.open).not.toHaveBeenCalled();
  });

  it('falls back to the native share sheet when WhatsApp is not installed', async () => {
    vi.useFakeTimers();
    vi.spyOn(shareBridge, 'assignLocation').mockImplementation(() => {});

    const pending = shareSocivaContent(payload);
    await vi.advanceTimersByTimeAsync(1300);
    const result = await pending;

    expect(result).toBe('shared');
    expect(shareMock.share).toHaveBeenCalledWith({
      title: payload.title,
      text: payload.text,
      dialogTitle: payload.title,
    });
    expect(browserMock.open).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as cancelled', async () => {
    vi.useFakeTimers();
    vi.spyOn(shareBridge, 'assignLocation').mockImplementation(() => {});
    shareMock.share.mockRejectedValue(new Error('Share canceled'));

    const pending = shareSocivaContent(payload);
    await vi.advanceTimersByTimeAsync(1300);
    const result = await pending;

    expect(result).toBe('cancelled');
    expect(browserMock.open).not.toHaveBeenCalled();
  });

  it('returns failed only when WhatsApp, share, and clipboard all fail', async () => {
    vi.useFakeTimers();
    vi.spyOn(shareBridge, 'assignLocation').mockImplementation(() => {});
    shareMock.share.mockRejectedValue(new Error('Share plugin is not implemented on android'));

    const pending = shareSocivaContent(payload);
    await vi.advanceTimersByTimeAsync(1300);
    const result = await pending;

    expect(result).toBe('failed');
    expect(browserMock.open).not.toHaveBeenCalled();
  });
});

describe('shareSocivaContent web', () => {
  beforeEach(() => {
    native.on = false;
    browserMock.open.mockReset();
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses wa.me in a new tab, never Capacitor Browser', async () => {
    const opened = { closed: false } as Window;
    const openBlank = vi.spyOn(shareBridge, 'openBlank').mockReturnValue(opened);

    const result = await shareSocivaContent(payload);

    expect(result).toBe('whatsapp');
    expect(String(openBlank.mock.calls[0]?.[0])).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(String(openBlank.mock.calls[0]?.[0]).split('text=')[1])).toBe(payload.text);
    expect(browserMock.open).not.toHaveBeenCalled();
  });
});
