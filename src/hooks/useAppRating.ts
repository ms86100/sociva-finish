// @ts-nocheck
import { useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Hook for requesting app store ratings using native dialogs.
 * Only works on native iOS/Android platforms.
 */
export function useAppRating() {
  const requestRating = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      console.log('App rating is only available on native platforms');
      return;
    }

    try {
      // Dynamic import to avoid issues on web
      const { RateApp } = await import('capacitor-rate-app');
      await RateApp.requestReview();
    } catch (error) {
      console.error('Error requesting app rating:', error);
    }
  }, []);

  /**
   * Request rating after a positive user experience.
   * Call this after successful order completion, positive review, etc.
   * The native OS will decide whether to show the prompt based on its own criteria.
   */
  const requestRatingAfterPositiveExperience = useCallback(async () => {
    // Check if we've recently asked for a rating
    const lastRatingRequest = localStorage.getItem('last_rating_request');
    const now = Date.now();
    
    // Don't ask more than once per week
    if (lastRatingRequest && now - parseInt(lastRatingRequest) < 7 * 24 * 60 * 60 * 1000) {
      return;
    }

    // Check if user has completed enough positive actions
    const positiveActions = parseInt(localStorage.getItem('positive_actions') || '0');
    
    // Only ask after at least 3 positive actions (orders, reviews, etc.)
    if (positiveActions >= 3) {
      await requestRating();
      localStorage.setItem('last_rating_request', now.toString());
    }
  }, [requestRating]);

  /**
   * Track a positive user action (order completed, review submitted, etc.)
   */
  const trackPositiveAction = useCallback(() => {
    const current = parseInt(localStorage.getItem('positive_actions') || '0');
    localStorage.setItem('positive_actions', (current + 1).toString());
  }, []);

  return {
    requestRating,
    requestRatingAfterPositiveExperience,
    trackPositiveAction,
  };
}
