// @ts-nocheck
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PermissionCenter } from '@/components/permissions/PermissionCenter';
import { useAuth } from '@/contexts/AuthContext';
import {
  peekPostLoginPermissionSheet,
  shouldDeferPostLoginPermissionSheet,
} from '@/hooks/usePermissionLifecycle';
import { hasSeenOnboarding } from '@/lib/onboarding-seen';
import { peekPendingAuthAction } from '@/lib/pending-auth-action';

/**
 * Post-login soft sheet - shown once after successful auth when marked.
 * Never auto-fires the native OS notification dialog.
 * Gated behind onboarding completion so it never overlaps the walkthrough.
 * Deferred on /cart so checkout is never blocked by the permission sheet.
 */
export function PostLoginPermissionSheet() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (open) return;
    if (!peekPostLoginPermissionSheet()) return;
    if (user?.id && !hasSeenOnboarding(user.id)) return;

    // Keep the mark; open later when user leaves checkout / profile onboarding.
    if (shouldDeferPostLoginPermissionSheet(location.pathname)) return;
    const pending = peekPendingAuthAction();
    if (pending?.type === 'checkout' || pending?.type === 'add_to_cart') return;

    // Wait until Home is showing (after account, header, or any login path).
    if (location.pathname !== '/') return;

    const t = setTimeout(() => {
      // Do not consume the mark here - HomePushEnableCard still needs it
      // so "Stay in the Loop" shows even if this sheet is closed early.
      if (!peekPostLoginPermissionSheet()) return;
      if (user?.id && !hasSeenOnboarding(user.id)) return;
      setOpen(true);
    }, 800);
    return () => clearTimeout(t);
  }, [location.pathname, open, user?.id]);

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
