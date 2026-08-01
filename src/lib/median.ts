// @ts-nocheck
/**
 * Median.co Bridge Integration
 * Handles SPA navigation and native bridge initialization for Median.co webview
 */

// Type declarations for Median.co bridge
declare global {
  interface Window {
    median?: {
      jsNavigation?: {
        url?: (params: { url: string; callback?: () => void }) => void;
      };
      share?: (params: { url?: string; text?: string }) => void;
      clipboard?: {
        set?: (params: { data: string }) => void;
      };
    };
    gonative?: boolean;
  }
}

/**
 * Check if running inside Median.co webview
 */
export function isMedianApp(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check for gonative flag or median bridge
  return !!(
    window.gonative || 
    window.median || 
    window.navigator.userAgent.includes('gonative') ||
    window.navigator.userAgent.includes('median')
  );
}

/**
 * Convert a standard URL path to hash-based route
 * e.g., /welcome → /#/welcome
 */
export function convertToHashRoute(url: string): string {
  try {
    const urlObj = new URL(url, window.location.origin);
    const path = urlObj.pathname;
    const search = urlObj.search;
    const hash = urlObj.hash;
    
    // If already has hash route, return as-is
    if (hash.startsWith('#/')) {
      return url;
    }
    
    // Convert path to hash route
    return `${window.location.origin}/#${path}${search}`;
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Initialize Median.co bridge and set up SPA navigation handlers
 * Call this in your app's root component
 */
export function initializeMedianBridge(navigate: (path: string) => void): (() => void) | undefined {
  if (!isMedianApp()) {
    console.log('[Median] Not running in Median.co webview');
    return undefined;
  }
  
  console.log('[Median] Initializing bridge for SPA navigation');
  
  // Set up custom event listener for Median navigation
  const handleMedianNavigation = (event: CustomEvent<{ url: string }>) => {
    const { url } = event.detail;
    console.log('[Median] Navigation event received:', url);
    
    try {
      const urlObj = new URL(url, window.location.origin);
      let targetPath = urlObj.pathname;
      
      // Handle hash-based routing
      if (urlObj.hash.startsWith('#/')) {
        targetPath = urlObj.hash.slice(1); // Remove # prefix
      }
      
      // Navigate using React Router
      navigate(targetPath + urlObj.search);
    } catch (error) {
      console.error('[Median] Navigation error:', error);
    }
  };
  
  // Listen for custom navigation events
  window.addEventListener('medianNavigation', handleMedianNavigation as EventListener);
  
  // Override default link behavior for Median
  const handleLinkClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    
    if (anchor && anchor.href && anchor.href.startsWith(window.location.origin)) {
      // Internal link - let React Router handle it
      return;
    }
  };
  
  document.addEventListener('click', handleLinkClick);
  
  // Cleanup function
  return () => {
    window.removeEventListener('medianNavigation', handleMedianNavigation as EventListener);
    document.removeEventListener('click', handleLinkClick);
  };
}

/**
 * Safe JSON parse with fallback - use this for localStorage operations
 */
export function safeJSONParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn('[Median] JSON parse error, returning fallback:', error);
    return fallback;
  }
}

/**
 * Share content using Median's native share dialog (falls back to Web Share API)
 */
export async function shareContent(text: string, url?: string): Promise<boolean> {
  if (isMedianApp() && window.median?.share) {
    window.median.share({ text, url });
    return true;
  }
  
  // Fallback to Web Share API
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return true;
    } catch {
      return false;
    }
  }
  
  return false;
}

/**
 * Copy to clipboard using Median's native clipboard (falls back to browser API)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (isMedianApp() && window.median?.clipboard?.set) {
    window.median.clipboard.set({ data: text });
    return true;
  }
  
  // Fallback to browser API
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
