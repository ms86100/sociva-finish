// @ts-nocheck
import { useState, useCallback, useEffect, ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FeedbackPopup, FEEDBACK_AUTO_DISMISS_MS } from '@/components/ui/FeedbackPopup';

interface FeedbackPopupOptions {
  title: string;
  description?: string;
  variant?: 'success' | 'info' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
}

interface FeedbackState extends FeedbackPopupOptions {
  isOpen: boolean;
}

const EMPTY_STATE: FeedbackState = { isOpen: false, title: '' };

let memoryState: FeedbackState = EMPTY_STATE;
const listeners = new Set<(state: FeedbackState) => void>();
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: FeedbackState) {
  memoryState = next;
  listeners.forEach((listener) => listener(next));
}

function clearDismissTimer() {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

export function showFeedback(options: FeedbackPopupOptions) {
  try {
    clearDismissTimer();
    emit({ isOpen: true, ...options });
    if (!options.actionLabel) {
      dismissTimer = setTimeout(() => {
        emit({ ...memoryState, isOpen: false });
      }, FEEDBACK_AUTO_DISMISS_MS);
    }
  } catch (err) {
    console.warn('showFeedback failed', err);
  }
}

if (typeof window !== 'undefined') {
  window.showFeedback = showFeedback;
}

export function hideFeedback() {
  clearDismissTimer();
  emit({ ...memoryState, isOpen: false });
}

export function getFeedbackState() {
  return memoryState;
}

/** Safe from callbacks and mutations — do not turn this back into a React hook. */
export function useFeedbackPopup() {
  return { showFeedback };
}

export function FeedbackPopupProvider({ children }: { children: ReactNode }) {
  const [feedbackState, setFeedbackState] = useState<FeedbackState>(memoryState);

  useEffect(() => {
    listeners.add(setFeedbackState);
    setFeedbackState(memoryState);
    return () => {
      listeners.delete(setFeedbackState);
    };
  }, []);

  const handleClose = useCallback(() => {
    hideFeedback();
  }, []);

  return (
    <>
      {children}
      <AnimatePresence>
        {feedbackState.isOpen && (
          <FeedbackPopup
            key={feedbackState.title}
            isOpen
            onClose={handleClose}
            title={feedbackState.title}
            description={feedbackState.description}
            variant={feedbackState.variant}
            actionLabel={feedbackState.actionLabel}
            onAction={feedbackState.onAction}
          />
        )}
      </AnimatePresence>
    </>
  );
}
