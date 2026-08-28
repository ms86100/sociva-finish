// @ts-nocheck
import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { recordNavigationPath } from '@/lib/navigation-stack';

/** Records in-app route changes for useSmartBack. Mount once inside AppShell. */
export function NavigationStackTracker() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    recordNavigationPath(location.pathname, navType);
  }, [location.pathname, navType]);

  return null;
}
