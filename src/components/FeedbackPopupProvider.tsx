// @ts-nocheck
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { FeedbackPopup } from '@/components/ui/FeedbackPopup';

interface FeedbackPopupContextType {
  showFeedback: (options: FeedbackPopupOptions) => void;
  FeedbackPopup: React.ReactElement | null;
}

interface FeedbackPopupOptions {
  title: string;
  description?: string;
  variant?: 'success' | 'info' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
}

const FeedbackPopupContext = createContext<FeedbackPopupContextType | undefined>(undefined);

export function FeedbackPopupProvider({ children }: { children: ReactNode }) {
  const [feedbackState, setFeedbackState] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    variant?: 'success' | 'info' | 'warning';
    actionLabel?: string;
    onAction?: () => void;
  }>({ isOpen: false, title: '' });

  const showFeedback = useCallback((
    options: FeedbackPopupOptions
  ) => {
    setFeedbackState({
      isOpen: true,
      ...options
    });
  }, []);

  const handleClose = useCallback(() => {
    setFeedbackState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const feedbackPopup = (
    <FeedbackPopup
      isOpen={feedbackState.isOpen}
      onClose={handleClose}
      title={feedbackState.title}
      description={feedbackState.description}
      variant={feedbackState.variant}
      actionLabel={feedbackState.actionLabel}
      onAction={feedbackState.onAction}
    />
  );

  return (
    <FeedbackPopupContext.Provider value={{
      showFeedback,
      FeedbackPopup: feedbackPopup,
    }}>
      {children}
      {/* Portal for feedback popup - render at end of body to avoid clipping */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
        {feedbackPopup}
      </div>
    </FeedbackPopupContext.Provider>
  );
}

export function useFeedbackPopup() {
  const context = useContext(FeedbackPopupContext);
  if (context === undefined) {
    throw new Error('useFeedbackPopup must be used within a FeedbackPopupProvider');
  }
  return context;
}