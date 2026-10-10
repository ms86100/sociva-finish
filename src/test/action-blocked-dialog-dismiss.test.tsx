import { describe, expect, it, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActionBlockedDialog } from '@/components/feedback/ActionBlockedDialog';
import { notify } from '@/lib/notify';
import { tryCloseTopOverlay } from '@/lib/navigation-stack';

function renderDialog() {
  return render(
    <MemoryRouter>
      <ActionBlockedDialog />
    </MemoryRouter>,
  );
}

describe('ActionBlockedDialog dismissal', () => {
  afterEach(() => {
    act(() => notify.clear());
  });

  it('Escape on a confirmation cancels instead of confirming', async () => {
    renderDialog();
    let result: Promise<boolean> | undefined;
    act(() => {
      result = notify.confirm('Delete this product?', { id: 'escape-cancel-test' });
    });
    await screen.findByText('Delete this product?');

    act(() => {
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' });
    });

    await expect(result).resolves.toBe(false);
  });

  it('Android Back layer closes the alert dialog and cancels the confirmation', async () => {
    renderDialog();
    let result: Promise<boolean> | undefined;
    act(() => {
      result = notify.confirm('Cancel this booking?', { id: 'back-cancel-test' });
    });
    await screen.findByText('Cancel this booking?');

    let handled = false;
    act(() => {
      handled = tryCloseTopOverlay();
    });

    expect(handled).toBe(true);
    await expect(result).resolves.toBe(false);
  });

  it('Escape on a plain block notice still acknowledges it', async () => {
    renderDialog();
    let acked = false;
    act(() => {
      notify.block('Select a category to continue', { id: 'escape-ack-test', onAck: () => { acked = true; } });
    });
    await screen.findByText('Select a category to continue');

    act(() => {
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' });
    });

    expect(acked).toBe(true);
  });
});
