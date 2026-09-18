// @ts-nocheck
import type { AdminDirectoryUser } from '@/hooks/useAdminData';

/** Compose a readable address from profile + society fields. */
export function composeUserAddress(user: Partial<AdminDirectoryUser> | null | undefined): string {
  if (!user) return '';
  const unit = [user.block, user.flat_number].filter(Boolean).join(' ').trim();
  const parts = [
    unit || null,
    user.phase || null,
    user.society?.name || null,
    user.society?.address || null,
    [user.society?.city, user.society?.state, user.society?.pincode].filter(Boolean).join(', ') || null,
  ].filter(Boolean);
  return parts.join(', ');
}

/** Local calendar date string YYYY-MM-DD for "today" filter (device local). */
export function localDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
