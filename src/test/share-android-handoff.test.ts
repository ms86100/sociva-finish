import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { androidShareIntentUrl, buildShareOpenScript } from '@/lib/share-android-handoff';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('android share handoff', () => {
  it('targets the Sociva package and falls back to the same share page', () => {
    const intent = androidShareIntentUrl('https://www.sociva.in/api/share/product/p1?og=1');
    expect(intent.startsWith('intent://www.sociva.in/api/share/product/p1?og=1#Intent;')).toBe(true);
    expect(intent).toContain('package=app.sociva.community');
    expect(intent).toContain('scheme=https');
    expect(decodeURIComponent(intent)).toContain('stay=1');
    expect(intent).not.toContain('#/product/');
  });

  it('keeps iOS on the hash deep link and only auto-opens Android when stay is absent', () => {
    const script = buildShareOpenScript(
      'https://www.sociva.in/api/share/product/p1?og=1',
      'https://www.sociva.in/#/product/p1',
    );
    expect(script).toContain('location.replace(deepLink)');
    expect(script).toContain('if (!android || inApp)');
    expect(script).toContain('if (!stay) location.href = intent');
    expect(script).toContain('/#/product/p1');
  });

  it('leaves the public share URL and iOS association file unchanged', () => {
    const productApi = read('api/share/product/[id].ts');
    const apple = read('public/.well-known/apple-app-site-association');
    expect(productApi).toContain('og:image');
    expect(productApi).toContain('buildShareOpenScript');
    expect(productApi).not.toContain('http-equiv="refresh"');
    expect(apple).toContain('6HBR38JB8Z.app.sociva.community');
    expect(apple).toContain('"/*"');
  });
});
