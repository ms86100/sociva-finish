// @ts-nocheck
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PermissionCenter } from '@/components/permissions/PermissionCenter';
import {
  peekPostLoginPermissionSheet,
  shouldDeferPostLoginPermissionSheet,
} from '@/hooks/usePermissionLifecycle';
import { peekPendingAuthAction } from '@/lib/pending-auth-action';

/**
 * Post-login soft sheet - shown once after OTP when marked by useAuthPage.
 * Never auto-fires the native OS notification dialog.
 * Deferred on /cart so checkout is never blocked by the permission sheet.
 * Keeps the post-login mark until Home has rendered so HomePushEnableCard
 * can still bypass cooldown if the sheet is dismissed with Maybe later.
 */
export function PostLoginPermissionSheet() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (open) return;
    if (!peekPostLoginPermissionSheet()) return;

    // Keep the mark; open later when user leaves checkout / profile onboarding.
    if (shouldDeferPostLoginPermissionSheet(location.pathname)) return;
    const pending = peekPendingAuthAction();
    if (pending?.type === 'checkout' || pending?.type === 'add_to_cart') return;

    // Wait until Home is showing (after account, header, or any login path).
    if (location.pathname !== '/') return;

    const t = setTimeout(() => {
      // Do not consume the mark here - HomePushEnableCard still needs it
      // so "Stay in the loop" shows even if this sheet is closed early.
      if (!peekPostLoginPermissionSheet()) return;
      setOpen(true);
    }, 800);
    return () => clearTimeout(t);
  }, [location.pathname, open]);

  if (!open) return null;

  return (
    <PermissionCenter
      variant="sheet"
      attentionOnly
      onDismissed={() => {
        // Sheet closed; leave mark for home card until Allow / Not now there.
        setOpen(false);
      }}
    />
  );
}
