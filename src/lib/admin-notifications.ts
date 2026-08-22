// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared notification layer for all admin review actions.
 * Every seller/license/product status change MUST go through these functions.
 * All notifications are routed through notification_queue for reliable delivery.
 */

export async function notifySellerStatusChange(
  userId: string,
  businessName: string,
  status: 'approved' | 'rejected' | 'suspended',
  rejectionNote?: string,
  sellerId?: string,
) {
  const { error } = await supabase.rpc('enqueue_seller_lifecycle_notification', {
    p_user_id: userId,
    p_business_name: businessName,
    p_status: status,
    p_seller_id: sellerId || null,
    p_rejection_note: rejectionNote || null,
  });
  if (error) console.error('Failed to enqueue seller notification:', error);
}

export async function notifyLicenseStatusChange(
  userId: string,
  licenseType: string,
  status: 'approved' | 'rejected',
  adminNotes?: string,
) {
  const title = status === 'approved'
    ? `✅ Your ${licenseType} has been verified!`
    : `❌ Your ${licenseType} was rejected`;

  const body = status === 'approved'
    ? `Your ${licenseType} has been verified. You're all set!`
    : `Your ${licenseType} was rejected.${adminNotes ? ` Reason: ${adminNotes}` : ' Please re-upload a valid document.'}`;

  const type = status === 'approved' ? 'license_approved' : 'license_rejected';

  const { error } = await supabase.from('notification_queue').insert({
    user_id: userId,
    title,
    body,
    type,
    reference_path: '/seller',
    payload: {
      type,
      action: status === 'approved' ? 'LICENSE_APPROVED' : 'LICENSE_REJECTED',
      status: type,
      target_role: 'seller',
      wa_template: 'sociva_store_status',
    },
  });
  if (error) console.error('Failed to enqueue license notification:', error);
}

/**
 * Notify all platform admins when a new store application is submitted for review.
 */
export async function notifyAdminsNewStoreApplication(
  businessName: string,
  sellerUserId: string,
) {
  try {
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (!adminRoles || adminRoles.length === 0) return;

    const rows = adminRoles
      .filter((r) => r.user_id !== sellerUserId)
      .map((r) => ({
        user_id: r.user_id,
        title: '🏪 New Store Application',
        body: `"${businessName}" has been submitted for review. Tap to moderate.`,
        type: 'moderation',
        reference_path: '/admin',
        payload: { type: 'new_store_application' },
      }));

    if (rows.length === 0) return;
    const { error } = await supabase.from('notification_queue').insert(rows);
    if (error) console.error('Failed to enqueue admin store notification:', error);
  } catch (err) {
    console.error('notifyAdminsNewStoreApplication error:', err);
  }
}

/** Notify platform admins when a seller requests a new category/subcategory. */
export async function notifyAdminsCategoryRequest(
  requestedName: string,
  requesterUserId: string,
) {
  try {
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (!adminRoles || adminRoles.length === 0) return;

    const rows = adminRoles
      .filter((r) => r.user_id !== requesterUserId)
      .map((r) => ({
        user_id: r.user_id,
        title: '📂 New category request',
        body: `A seller requested "${requestedName}". Tap to review in Catalog.`,
        type: 'moderation',
        reference_path: '/admin',
        payload: { type: 'category_request', requested_name: requestedName },
      }));

    if (rows.length === 0) return;
    const { error } = await supabase.from('notification_queue').insert(rows);
    if (error) console.error('Failed to enqueue admin category-request notification:', error);
  } catch (err) {
    console.error('notifyAdminsCategoryRequest error:', err);
  }
}

export async function notifyProductStatusChange(
  userId: string,
  productName: string,
  businessName: string,
  status: 'approved' | 'rejected',
  rejectionNote?: string,
) {
  const title = status === 'approved'
    ? `✅ Product "${productName}" approved!`
    : `❌ Product "${productName}" rejected`;

  const body = status === 'approved'
    ? `Your product "${productName}" from "${businessName}" is now live on the marketplace.`
    : `Your product "${productName}" was rejected.${rejectionNote ? ` Reason: ${rejectionNote}` : ' Please review and update.'}`;

  const type = status === 'approved' ? 'product_approved' : 'product_rejected';

  const { error } = await supabase.from('notification_queue').insert({
    user_id: userId,
    title,
    body,
    type,
    reference_path: '/seller',
    payload: {
      type,
      action: status === 'approved' ? 'PRODUCT_APPROVED' : 'PRODUCT_REJECTED',
      status: type,
      target_role: 'seller',
      wa_template: 'sociva_store_status',
    },
  });
  if (error) console.error('Failed to enqueue product notification:', error);
}
