// @ts-nocheck
import { useEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { consumeUntrustedPop, recordNavigationPath, toNavPath } from '@/lib/navigation-stack';

/** Records in-app route changes for useSmartBack. Mount once inside the router. */
export function NavigationStackTracker() {
  const location = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();
  const full = toNavPath(location.pathname, location.search);

  useEffect(() => {
    if (navType === 'POP') {
      const redirect = consumeUntrustedPop(full);
      if (redirect) {
        navigate(redirect, { replace: true, state: { socivaBack: true } });
        return;
      }
    }
    recordNavigationPath(location.pathname, navType, location.search);
  }, [full, location.pathname, location.search, navType, navigate]);

  return null;
}
