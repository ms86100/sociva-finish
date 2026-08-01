// @ts-nocheck
/**
 * Shared seller approval logic used by all admin paths:
 * - useSellerApplicationReview (AdminPage > SellerApplicationReview)
 * - useSocietyAdmin (SocietyAdminPage)
 * - useAdminData (AdminPage legacy tab)
 *
 * Ensures consistent behavior: sets is_available, approves products/licenses, manages roles.
 */
import { supabase } from '@/integrations/supabase/client';
import { logAudit } from '@/lib/audit';
import { notifySellerStatusChange } from '@/lib/admin-notifications';

interface ApproveSellerOptions {
  sellerId: string;
  userId: string;
  businessName: string;
  societyId?: string | null;
  rejectionNote?: string;
}

/**
 * Validates that the seller has location coordinates (direct or via society).
 * Returns true if valid, false otherwise.
 */
export async function validateSellerLocation(sellerId: string): Promise<{ valid: boolean; message?: string }> {
  const { data: sp } = await supabase
    .from('seller_profiles')
    .select('latitude, longitude, society_id')
    .eq('id', sellerId)
    .single();

  const hasDirectCoords = sp?.latitude != null && sp?.longitude != null;
  if (hasDirectCoords) return { valid: true };

  if (sp?.society_id) {
    const { data: soc } = await supabase
      .from('societies')
      .select('latitude, longitude')
      .eq('id', sp.society_id)
      .single();
    if (soc?.latitude != null && soc?.longitude != null) return { valid: true };
  }

  return { valid: false, message: 'Cannot approve: Store has no location set. Ask seller to set their store location first.' };
}

/**
 * Full seller approval: updates status, sets is_available, adds role,
 * auto-approves products + licenses, sends notification.
 */
export async function approveSeller({ sellerId, userId, businessName, societyId }: ApproveSellerOptions) {
  // 0. Validate location BEFORE any DB write — single source of truth for all admin paths
  const locCheck = await validateSellerLocation(sellerId);
  if (!locCheck.valid) {
    throw new Error(locCheck.message || 'Cannot approve: Store has no location set.');
  }

  // 1. Update seller profile: approved + available
  const { error: updateErr } = await supabase
    .from('seller_profiles')
    .update({
      verification_status: 'approved',
      rejection_note: null,
      is_available: true,
    } as any)
    .eq('id', sellerId);
  if (updateErr) throw updateErr;

  // 2. Ensure seller role exists (ignore duplicate)
  const { error: roleErr } = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role: 'seller' });
  if (roleErr && !roleErr.message?.includes('duplicate')) {
    console.error('[SellerApproval] Failed to add seller role:', roleErr);
  }

  // 3. Auto-approve pending/draft products created before this moment
  const cutoff = new Date().toISOString();
  const { error: prodErr } = await supabase
    .from('products')
    .update({ approval_status: 'approved' } as any)
    .eq('seller_id', sellerId)
    .in('approval_status', ['pending', 'draft'])
    .lte('created_at', cutoff);
  if (prodErr) console.error('[SellerApproval] Failed to approve products:', prodErr);

  // Clear edit snapshots for all approved products so admin only sees future diffs
  const { data: approvedProds } = await supabase.from('products').select('id').eq('seller_id', sellerId).eq('approval_status', 'approved');
  if (approvedProds?.length) {
    await supabase.from('product_edit_snapshots').delete().in('product_id', approvedProds.map(p => p.id));
  }

  // 4. Auto-approve pending licenses
  const { error: licErr } = await supabase
    .from('seller_licenses')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() } as any)
    .eq('seller_id', sellerId)
    .eq('status', 'pending');
  if (licErr) console.error('[SellerApproval] Failed to approve licenses:', licErr);

  // 5. Audit
  await logAudit('seller_approved', 'seller_profile', sellerId, societyId || '', { status: 'approved' });

  // 6. Notify
  await notifySellerStatusChange(userId, businessName, 'approved');

  // 7. Invalidate marketplace caches so other users see the new seller immediately
  invalidateMarketplaceCache();
}

/**
 * Reject or suspend a seller: updates status, removes role, sends notification.
 */
export async function rejectSeller({
  sellerId, userId, businessName, societyId, rejectionNote,
}: ApproveSellerOptions & { status: 'rejected' | 'suspended' }) {
  // arguments include status via the caller
}

export async function rejectOrSuspendSeller(
  sellerId: string,
  userId: string,
  businessName: string,
  status: 'rejected' | 'suspended',
  rejectionNote?: string,
  societyId?: string,
) {
  const { error } = await supabase
    .from('seller_profiles')
    .update({
      verification_status: status,
      rejection_note: rejectionNote?.trim() || null,
    } as any)
    .eq('id', sellerId);
  if (error) throw error;

  // Remove seller role
  await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'seller');

  await logAudit(`seller_${status}`, 'seller_profile', sellerId, societyId || '', {
    status,
    note: rejectionNote || undefined,
  });

  await notifySellerStatusChange(userId, businessName, status, rejectionNote?.trim() || undefined);

  invalidateMarketplaceCache();
}

/**
 * Dispatch a custom event that marketplace query hooks listen for to invalidate their caches.
 */
function invalidateMarketplaceCache() {
  window.dispatchEvent(new CustomEvent('app:invalidate-marketplace'));
}
