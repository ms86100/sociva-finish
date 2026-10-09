import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ on: false }));
const shareMock = vi.hoisted(() => ({ share: vi.fn() }));
const clipboardMock = vi.hoisted(() => ({ write: vi.fn() }));
const browserMock = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
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

import { shareSocivaContent } from '@/lib/sociva-share';

const payload = {
  title: 'Chicken Biryani',
  text: 'Found this on Sociva\nhttps://www.sociva.in/api/share/product/abc',
  url: 'https://www.sociva.in/api/share/product/abc',
};

describe('shareSocivaContent native', () => {
  beforeEach(() => {
    native.on = true;
    shareMock.share.mockReset();
    clipboardMock.write.mockReset();
    browserMock.open.mockReset();
    shareMock.share.mockResolvedValue(undefined);
    clipboardMock.write.mockRejectedValue(new Error('clipboard unavailable'));
    browserMock.open.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
      configurable: true,
    });
  });

  it('opens the native share sheet and returns shared', async () => {
    const result = await shareSocivaContent(payload);
    expect(result).toBe('shared');
    expect(shareMock.share).toHaveBeenCalledWith({
      title: payload.title,
      text: payload.text,
      dialogTitle: payload.title,
    });
    expect(browserMock.open).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as cancelled', async () => {
    shareMock.share.mockRejectedValue(new Error('Share canceled'));
    const result = await shareSocivaContent(payload);
    expect(result).toBe('cancelled');
    expect(browserMock.open).not.toHaveBeenCalled();
  });

  it('does not report failure when the share plugin is missing and Browser can open WhatsApp', async () => {
    shareMock.share.mockRejectedValue(new Error('Share plugin is not implemented on android'));
    const result = await shareSocivaContent(payload);
    expect(result).toBe('whatsapp');
    expect(browserMock.open).toHaveBeenCalledWith({
      url: expect.stringContaining('https://wa.me/?text='),
    });
  });

  it('returns failed only when share, clipboard, and the WhatsApp fallback all fail', async () => {
    shareMock.share.mockRejectedValue(new Error('Share plugin is not implemented on android'));
    browserMock.open.mockRejectedValue(new Error('browser unavailable'));
    const result = await shareSocivaContent(payload);
    expect(result).toBe('failed');
  });
});
