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

  const { error } = await supabase.rpc('enqueue_notification_for_user', {
    p_user_id: userId,
    p_title: title,
    p_body: body,
    p_type: type,
    p_reference_path: '/seller',
    p_payload: {
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
  sellerId?: string,
) {
  try {
    const { error } = await supabase.rpc('notify_platform_admins_new_store_application', {
      p_seller_user_id: sellerUserId,
      p_business_name: businessName,
      p_seller_id: sellerId || null,
    });
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
    const { error } = await supabase.rpc('notify_platform_admins_category_request', {
      p_requester_user_id: requesterUserId,
      p_requested_name: requestedName,
    });
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

  const { error } = await supabase.rpc('enqueue_notification_for_user', {
    p_user_id: userId,
    p_title: title,
    p_body: body,
    p_type: type,
    p_reference_path: '/seller',
    p_payload: {
      type,
      action: status === 'approved' ? 'PRODUCT_APPROVED' : 'PRODUCT_REJECTED',
      status: type,
      target_role: 'seller',
      wa_template: 'sociva_store_status',
    },
  });
  if (error) console.error('Failed to enqueue product notification:', error);
}
