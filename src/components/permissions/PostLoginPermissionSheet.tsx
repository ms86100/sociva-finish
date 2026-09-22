// @ts-nocheck
import { useEffect, useState } from 'react';
import { PermissionCenter } from '@/components/permissions/PermissionCenter';
import { consumePostLoginPermissionSheet } from '@/hooks/usePermissionLifecycle';

/**
 * Post-login soft sheet — shown once after OTP when marked by useAuthPage.
 * Never auto-fires the native OS notification dialog.
 */
export function PostLoginPermissionSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (consumePostLoginPermissionSheet()) {
      // Brief delay so navigation settles
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  if (!open) return null;

  return (
    <PermissionCenter
      variant="sheet"
      attentionOnly
      onDismissed={() => setOpen(false)}
    />
  );
}
