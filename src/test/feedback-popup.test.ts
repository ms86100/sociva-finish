import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getFeedbackState,
  hideFeedback,
  showFeedback,
  useFeedbackPopup,
} from '@/components/FeedbackPopupProvider';

afterEach(() => {
  hideFeedback();
  vi.useRealTimers();
});

describe('feedback popup API', () => {
  it('can be called outside of render without throwing', () => {
    expect(() => {
      showFeedback({ title: 'Address saved', variant: 'success' });
    }).not.toThrow();
    expect(getFeedbackState().isOpen).toBe(true);
    expect(getFeedbackState().title).toBe('Address saved');
  });

  it('useFeedbackPopup works from mutation-style callbacks', () => {
    const onSuccess = () => {
      const { showFeedback: show } = useFeedbackPopup();
      show({ title: 'Profile updated! Redirecting…', variant: 'success' });
    };

    expect(onSuccess).not.toThrow();
    expect(getFeedbackState().title).toBe('Profile updated! Redirecting…');
  });

  it('auto-dismisses success feedback without an action', () => {
    vi.useFakeTimers();
    showFeedback({ title: 'Address saved', variant: 'success' });
    expect(getFeedbackState().isOpen).toBe(true);

    vi.advanceTimersByTime(2200);
    expect(getFeedbackState().isOpen).toBe(false);
  });
});
