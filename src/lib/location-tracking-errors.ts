/**
 * Seller-facing location errors. Never surface native plugin / class names.
 */

export function errorText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || '';
  const rec = err as { message?: unknown; code?: unknown };
  if (typeof rec.message === 'string') return rec.message;
  return String(err);
}

export function errorCode(err: unknown): string {
  const rec = err as { code?: unknown };
  return rec && rec.code != null ? String(rec.code) : '';
}

/** Capacitor "plugin is not implemented on <platform>" (missing native pod / registration). */
export function isNativePluginUnimplemented(err: unknown): boolean {
  const code = errorCode(err).toUpperCase();
  if (code === 'UNIMPLEMENTED') return true;
  const msg = errorText(err).toLowerCase();
  return (
    msg.includes('plugin is not implemented') ||
    msg.includes('is not implemented on') ||
    (msg.includes('not implemented') && msg.includes('plugin'))
  );
}

export function isLocationPermissionDenied(err: unknown): boolean {
  const msg = errorText(err).toLowerCase();
  const code = errorCode(err).toUpperCase();
  if (code === 'PERMISSION_DENIED' || code === 'OS-PLUG-GLOC-0003') return true;
  return msg.includes('permission denied') || msg.includes('not authorized') || msg.includes('denied by user');
}

export function isLocationServicesDisabled(err: unknown): boolean {
  const msg = errorText(err).toLowerCase();
  const code = errorCode(err).toUpperCase();
  if (code === 'OS-PLUG-GLOC-0002' || code === 'LOCATION_UNAVAILABLE') return true;
  return (
    (msg.includes('location services') && (msg.includes('disabled') || msg.includes('off'))) ||
    msg.includes('location disabled') ||
    msg.includes('kclerror') ||
    msg.includes('location unknown')
  );
}

export type SellerLocationErrorKind =
  | 'permission_denied'
  | 'services_off'
  | 'unavailable'
  | 'failed';

export function classifySellerLocationError(err: unknown): SellerLocationErrorKind {
  if (isLocationPermissionDenied(err)) return 'permission_denied';
  if (isLocationServicesDisabled(err)) return 'services_off';
  if (isNativePluginUnimplemented(err)) return 'unavailable';
  return 'failed';
}

const SELLER_LOCATION_COPY: Record<SellerLocationErrorKind, string> = {
  permission_denied: 'Location permission denied. Enable it in Settings so the buyer can track this delivery.',
  services_off: 'Turn on Location Services in Settings to share your live location.',
  unavailable: "Couldn't start live tracking. Keep this screen open while you deliver, then try again.",
  failed: "Couldn't start location sharing. Check that Location is allowed, then try again.",
};

export function sellerLocationErrorMessage(err: unknown): string {
  return SELLER_LOCATION_COPY[classifySellerLocationError(err)];
}

export function looksLikeTechnicalLocationError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return (
    m.includes('backgroundgeolocation') ||
    m.includes('plugin is not implemented') ||
    m.includes('tslocationmanager') ||
    (m.includes('capacitor') && m.includes('unimplemented'))
  );
}
