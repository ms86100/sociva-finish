import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('what is new store link', () => {
  const section = fs.readFileSync(
    path.resolve(__dirname, '../components/home/WhatsNewSection.tsx'),
    'utf8',
  );
  const app = fs.readFileSync(
    path.resolve(__dirname, '../App.tsx'),
    'utf8',
  );

  it('opens the store page, not the missing plural path', () => {
    expect(section).toMatch(/to=\{`\/seller\/\$\{s\.id\}`\}/);
    expect(section).not.toMatch(/\/sellers\//);
  });

  it('redirects the old plural path to the store page', () => {
    expect(app).toMatch(/path="\/sellers\/:id"/);
    expect(app).toMatch(/LegacySellersRedirect/);
    expect(app).toMatch(/to=\{id \? `\/seller\/\$\{id\}` : '\/'\}/);
  });
});
