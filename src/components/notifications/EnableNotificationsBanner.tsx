// @ts-nocheck
/**
 * Home soft banner — thin surface of Permission Center (7-day cooldown inside hook).
 * Replaces the old EnableNotificationsBanner spam path.
 */
import { PermissionCenter } from '@/components/permissions/PermissionCenter';

export function EnableNotificationsBanner() {
  return <PermissionCenter variant="banner" attentionOnly />;
}
