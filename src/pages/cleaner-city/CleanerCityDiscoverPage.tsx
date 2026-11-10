// @ts-nocheck
import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * Legacy Discover hub - redirects into Play (Find / Offer).
 * Keeps old /discover bookmarks working without a confusing middle page.
 */
export default function CleanerCityDiscoverPage() {
  const [params] = useSearchParams();
  const offer = params.get('mode') === 'offer';
  return <Navigate to={offer ? '/cleaner-city/offer' : '/cleaner-city/find'} replace />;
}
