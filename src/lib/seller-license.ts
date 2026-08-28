/**
 * Centralized seller license eligibility — shared by admin approval and onboarding.
 * Status model (actual Sociva values on seller_licenses.status):
 *   pending | approved | rejected
 * Plus expires_at for expiry. "Not required" when requires_license/license_mandatory are false.
 */
import { supabase } from '@/integrations/supabase/client';

export type LicenseGateReason =
  | 'not_required'
  | 'ok_approved'
  | 'ok_pending_for_admin_approval'
  | 'missing'
  | 'rejected'
  | 'expired'
  | 'invalid';

export interface LicenseEligibility {
  required: boolean;
  mandatory: boolean;
  reason: LicenseGateReason;
  message?: string;
  licenseTypeName?: string | null;
  hasApproved: boolean;
  hasPending: boolean;
  hasRejected: boolean;
  hasExpiredOnly: boolean;
}

export async function evaluateSellerLicenseEligibility(sellerId: string): Promise<LicenseEligibility> {
  const { data: seller, error: sellerErr } = await supabase
    .from('seller_profiles')
    .select('id, primary_group, categories')
    .eq('id', sellerId)
    .single();
  if (sellerErr) throw sellerErr;

  const primaryGroup = (seller as any)?.primary_group as string | null;
  if (!primaryGroup) {
    return {
      required: false,
      mandatory: false,
      reason: 'not_required',
      hasApproved: false,
      hasPending: false,
      hasRejected: false,
      hasExpiredOnly: false,
    };
  }

  const [{ data: group }, { data: catRows }] = await Promise.all([
    supabase
      .from('parent_groups')
      .select('id, slug, requires_license, license_mandatory, license_type_name')
      .eq('slug', primaryGroup)
      .maybeSingle(),
    supabase
      .from('category_config')
      .select('id, requires_license, license_mandatory, license_type_name')
      .eq('parent_group', primaryGroup),
  ]);

  const cats = (catRows || []) as any[];
  const requires =
    !!(group as any)?.requires_license ||
    cats.some((c) => c.requires_license);
  const mandatory =
    !!(group as any)?.license_mandatory ||
    cats.some((c) => c.requires_license && c.license_mandatory);

  if (!requires || !mandatory) {
    return {
      required: requires,
      mandatory: false,
      reason: 'not_required',
      licenseTypeName: (group as any)?.license_type_name || null,
      hasApproved: false,
      hasPending: false,
      hasRejected: false,
      hasExpiredOnly: false,
    };
  }

  const licenseTypeName =
    (group as any)?.license_type_name ||
    cats.find((c) => c.license_type_name)?.license_type_name ||
    'required license';

  const categoryIds = cats.filter((c) => c.requires_license).map((c) => c.id);
  let q = supabase
    .from('seller_licenses')
    .select('id, status, expires_at, group_id, category_config_id')
    .eq('seller_id', sellerId)
    .order('submitted_at', { ascending: false })
    .limit(20);
  if ((group as any)?.id && categoryIds.length) {
    q = q.or(`group_id.eq.${(group as any).id},category_config_id.in.(${categoryIds.join(',')})`);
  } else if ((group as any)?.id) {
    q = q.eq('group_id', (group as any).id);
  }

  const { data: licenses, error: licErr } = await q;
  if (licErr) throw licErr;

  const now = Date.now();
  const rows = (licenses || []) as any[];
  const isExpired = (r: any) => r.expires_at && new Date(r.expires_at).getTime() <= now;
  const hasApproved = rows.some((r) => r.status === 'approved' && !isExpired(r));
  const hasPending = rows.some((r) => r.status === 'pending' && !isExpired(r));
  const hasRejected = rows.some((r) => r.status === 'rejected');
  const hasExpiredOnly =
    rows.length > 0 &&
    !hasApproved &&
    !hasPending &&
    rows.every((r) => r.status === 'approved' && isExpired(r));

  if (hasApproved) {
    return {
      required: true,
      mandatory: true,
      reason: 'ok_approved',
      licenseTypeName,
      hasApproved,
      hasPending,
      hasRejected,
      hasExpiredOnly: false,
    };
  }
  if (hasPending) {
    return {
      required: true,
      mandatory: true,
      reason: 'ok_pending_for_admin_approval',
      message: `Pending ${licenseTypeName} will be approved with the store.`,
      licenseTypeName,
      hasApproved,
      hasPending,
      hasRejected,
      hasExpiredOnly: false,
    };
  }
  if (hasExpiredOnly) {
    return {
      required: true,
      mandatory: true,
      reason: 'expired',
      message: adminLicenseApprovalMessage('expired', licenseTypeName),
      licenseTypeName,
      hasApproved: false,
      hasPending: false,
      hasRejected,
      hasExpiredOnly: true,
    };
  }
  if (hasRejected && rows.length > 0) {
    return {
      required: true,
      mandatory: true,
      reason: 'rejected',
      message: adminLicenseApprovalMessage('rejected', licenseTypeName),
      licenseTypeName,
      hasApproved: false,
      hasPending: false,
      hasRejected: true,
      hasExpiredOnly: false,
    };
  }
  return {
    required: true,
    mandatory: true,
    reason: 'missing',
    message: adminLicenseApprovalMessage('missing', licenseTypeName),
    licenseTypeName,
    hasApproved: false,
    hasPending: false,
    hasRejected: false,
    hasExpiredOnly: false,
  };
}

export function adminLicenseApprovalMessage(
  reason: 'missing' | 'rejected' | 'expired',
  licenseTypeName: string,
): string {
  switch (reason) {
    case 'expired':
      return `Cannot approve: ${licenseTypeName} is expired. Ask the seller to upload a valid license.`;
    case 'rejected':
      return `Cannot approve: ${licenseTypeName} was rejected. Ask the seller to re-upload a valid license.`;
    default:
      return `Cannot approve: mandatory ${licenseTypeName} is missing. Ask the seller to upload it first.`;
  }
}

/** Direct seller-facing copy for onboarding submit gates. */
export function sellerLicenseSubmitMessage(el: LicenseEligibility): string {
  const name = el.licenseTypeName || 'license';
  switch (el.reason) {
    case 'missing':
      return `Please upload your ${name} before submitting. Your progress is saved — you can return anytime to finish.`;
    case 'rejected':
      return `Your ${name} was rejected. Please upload a valid document before submitting.`;
    case 'expired':
      return `Your ${name} has expired. Please upload a valid document before submitting.`;
    default:
      return `Please upload your ${name} before submitting.`;
  }
}

/** True when seller must upload/fix license before continuing or submitting. */
export function licenseBlocksSellerProgress(el: LicenseEligibility): boolean {
  if (!el.mandatory || el.reason === 'not_required') return false;
  return el.reason !== 'ok_approved' && el.reason !== 'ok_pending_for_admin_approval';
}

/** Blocks store approval when mandatory license is missing/rejected/expired. Pending is allowed (admin approval covers it). */
export function assertLicenseAllowsAdminApproval(el: LicenseEligibility): void {
  if (!el.mandatory || el.reason === 'not_required' || el.reason === 'ok_approved' || el.reason === 'ok_pending_for_admin_approval') {
    return;
  }
  throw new Error(el.message || `Cannot approve: license requirement not met (${el.reason}).`);
}

/** Seller cannot submit for review without at least a pending/approved non-expired license when mandatory. */
export function assertLicenseAllowsSellerSubmit(el: LicenseEligibility): void {
  if (!licenseBlocksSellerProgress(el)) return;
  throw new Error(sellerLicenseSubmitMessage(el));
}
