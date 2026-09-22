// @ts-nocheck
/**
 * Home soft banner — location prompt only (7-day cooldown in usePermissionLifecycle).
 * Notification enable lives in Profile Permission Center / post-login sheet — not here.
 */
import { PermissionCenter } from '@/components/permissions/PermissionCenter';

export function EnableNotificationsBanner() {
  return <PermissionCenter variant="banner" attentionOnly />;
}
