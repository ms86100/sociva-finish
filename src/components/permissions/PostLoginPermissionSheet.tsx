// @ts-nocheck
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PermissionCenter } from '@/components/permissions/PermissionCenter';
import {
  consumePostLoginPermissionSheet,
  peekPostLoginPermissionSheet,
  shouldDeferPostLoginPermissionSheet,
} from '@/hooks/usePermissionLifecycle';
import { peekPendingAuthAction } from '@/lib/pending-auth-action';

/**
 * Post-login soft sheet — shown once after OTP when marked by useAuthPage.
 * Never auto-fires the native OS notification dialog.
 * Deferred on /cart so checkout is never blocked by the permission sheet.
 */
export function PostLoginPermissionSheet() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (open) return;
    if (!peekPostLoginPermissionSheet()) return;

    // Keep the mark; open later when user leaves checkout.
    if (shouldDeferPostLoginPermissionSheet(location.pathname)) return;
    const pending = peekPendingAuthAction();
    if (pending?.type === 'checkout') return;

    if (!consumePostLoginPermissionSheet()) return;

    const t = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(t);
  }, [location.pathname, open]);

  if (!open) return null;

  return (
    <PermissionCenter
      variant="sheet"
      attentionOnly
      onDismissed={() => setOpen(false)}
    />
  );
}
