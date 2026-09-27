import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('help ticket keyboard and notice wiring', () => {
  const help = fs.readFileSync(
    path.resolve(__dirname, '../components/order/OrderHelpSheet.tsx'),
    'utf8',
  );
  const detail = fs.readFileSync(
    path.resolve(__dirname, '../components/support/SupportTicketDetail.tsx'),
    'utf8',
  );
  const feedback = fs.readFileSync(
    path.resolve(__dirname, '../components/admin/AdminFeedbackViewer.tsx'),
    'utf8',
  );

  it('lifts the need-help drawer above the keyboard', () => {
    expect(help).toMatch(/useKeepDrawerFieldVisible/);
    expect(help).toMatch(/getDrawerKeyboardStyle/);
    expect(help).toMatch(/data-drawer-scroll/);
    expect(help).toMatch(/repositionInputs=\{false\}/);
  });

  it('lifts the ticket reply composer above the keyboard', () => {
    expect(detail).toMatch(/useKeepDrawerFieldVisible/);
    expect(detail).toMatch(/getDrawerKeyboardStyle/);
    expect(detail).toMatch(/data-drawer-scroll/);
    expect(detail).toMatch(/data-keyboard-field/);
  });

  it('loads feedback without the broken profile embed', () => {
    expect(feedback).not.toMatch(/user_feedback_user_id_fkey/);
    expect(feedback).toMatch(/Could not load feedback/);
    expect(feedback).toMatch(/from\('profiles'\)/);
  });
});
