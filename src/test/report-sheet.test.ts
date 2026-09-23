import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('report types', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../components/report/ReportSheet.tsx'),
    'utf8',
  );

  it('only allows DB CHECK constraint values', () => {
    expect(src).toMatch(/value: 'inappropriate'/);
    expect(src).toMatch(/value: 'spam'/);
    expect(src).toMatch(/value: 'fraud'/);
    expect(src).toMatch(/value: 'harassment'/);
    expect(src).toMatch(/value: 'other'/);
  });

  it('does not expose invalid UI-only report types', () => {
    expect(src).not.toMatch(/value: 'misleading'/);
    expect(src).not.toMatch(/value: 'offensive'/);
    expect(src).not.toMatch(/value: 'prohibited'/);
  });

  it('ReportSheet uses drawer keyboard lift helpers and visible feedback', () => {
    expect(src).toMatch(/useKeepDrawerFieldVisible/);
    expect(src).toMatch(/getDrawerKeyboardStyle/);
    expect(src).toMatch(/data-drawer-scroll/);
    expect(src).toMatch(/showFeedback/);
    expect(src).toMatch(/role="radiogroup"/);
    expect(src).toMatch(/reported_product_id/);
    expect(src).not.toMatch(/toast\.error/);
  });
});
