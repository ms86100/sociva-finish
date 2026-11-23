import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';

export type OnboardSocietyInput = {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

export type OnboardResult<T = string> =
  | { ok: true; id: T }
  | { ok: false; error: string };

export function slugifyLabel(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
  return base || 'society';
}

function uniqueSlug(value: string): string {
  return `${slugifyLabel(value)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function createSocietyRecord(input: OnboardSocietyInput): Promise<OnboardResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Society name is required' };

  const payload = {
    name,
    slug: uniqueSlug(name),
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    pincode: input.pincode?.trim() || null,
    is_verified: false,
    is_active: false,
  };

  const { data, error } = await supabase
    .from('societies')
    .insert(payload)
    .select('id')
    .single();
  if (error || !data?.id) return { ok: false, error: error?.message || 'Could not create society' };
  return { ok: true, id: data.id };
}

export async function verifyAndActivateSociety(societyId: string): Promise<OnboardResult> {
  const { data: current } = await supabase
    .from('societies')
    .select('invite_code')
    .eq('id', societyId)
    .maybeSingle();
  const invite_code = current?.invite_code || Math.random().toString(36).substring(2, 8).toUpperCase();
  const { error } = await supabase
    .from('societies')
    .update({ is_verified: true, is_active: true, invite_code })
    .eq('id', societyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: societyId };
}

export async function createBuilderRecord(name: string): Promise<OnboardResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Builder name is required' };
  const { data, error } = await supabase
    .from('builders')
    .insert({
      name: trimmed,
      slug: uniqueSlug(trimmed),
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data?.id) return { ok: false, error: error?.message || 'Could not create builder' };
  return { ok: true, id: data.id };
}

export async function assignPackageToSociety(args: {
  societyId: string;
  packageId: string;
  builderId?: string | null;
  assignedBy?: string | null;
}): Promise<OnboardResult> {
  const { societyId, packageId } = args;
  if (!societyId || !packageId) return { ok: false, error: 'Society and package are required' };

  const { data, error } = await supabase.rpc('admin_assign_society_package', {
    _society_id: societyId,
    _package_id: packageId,
    _builder_id: args.builderId || null,
  });

  if (error) return { ok: false, error: error.message };
  const builderId = (data as { builder_id?: string } | null)?.builder_id;
  if (!builderId) return { ok: false, error: 'Package assign returned no builder' };
  return { ok: true, id: builderId };
}

export async function appointSocietyAdmin(args: {
  societyId: string;
  userId: string;
  appointedBy?: string | null;
  role?: 'admin' | 'moderator';
}): Promise<OnboardResult> {
  const role = args.role || 'admin';
  const { error } = await supabase.from('society_admins').insert({
    society_id: args.societyId,
    user_id: args.userId,
    role,
    appointed_by: args.appointedBy || null,
  });
  if (error && error.code !== '23505') return { ok: false, error: error.message };

  await supabase
    .from('societies')
    .update({ admin_user_id: args.userId })
    .eq('id', args.societyId);

  return { ok: true, id: args.userId };
}

export async function searchResidentsForAppoint(query: string, societyId?: string) {
  const q = escapeIlike(query.trim()).replace(/,/g, '');
  if (q.length < 2) return [];
  let req = supabase
    .from('profiles')
    .select('id, name, phone, block, flat_number, society_id, verification_status')
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(12);
  if (societyId) req = req.eq('society_id', societyId);
  const { data } = await req;
  return data || [];
}

export type SocietyOnboardSnapshot = {
  society: {
    id: string;
    name: string;
    city: string | null;
    pincode: string | null;
    is_verified: boolean | null;
    is_active: boolean | null;
    invite_code: string | null;
    builder_id: string | null;
    admin_user_id: string | null;
  };
  builderId: string | null;
  builderName: string | null;
  packageId: string | null;
  packageName: string | null;
  adminCount: number;
};

export type PackageFeatureChip = {
  key: string;
  name: string;
};

export async function listPackageFeatures(packageId: string): Promise<PackageFeatureChip[]> {
  const { data } = await supabase
    .from('feature_package_items')
    .select('enabled, feature:platform_features(feature_key, display_name, feature_name)')
    .eq('package_id', packageId)
    .eq('enabled', true);
  return (data || [])
    .map((row) => {
      const feature = (row as { feature?: { feature_key?: string; display_name?: string | null; feature_name?: string | null } }).feature;
      return {
        key: feature?.feature_key || '',
        name: feature?.display_name || feature?.feature_name || feature?.feature_key || '',
      };
    })
    .filter((row) => row.key);
}

export async function loadSocietyOnboardSnapshot(societyId: string): Promise<SocietyOnboardSnapshot | null> {
  const { data: society } = await supabase
    .from('societies')
    .select('id, name, city, pincode, is_verified, is_active, invite_code, builder_id, admin_user_id')
    .eq('id', societyId)
    .maybeSingle();
  if (!society) return null;

  let builderId = society.builder_id as string | null;
  if (!builderId) {
    const { data: link } = await supabase
      .from('builder_societies')
      .select('builder_id')
      .eq('society_id', societyId)
      .limit(1)
      .maybeSingle();
    builderId = link?.builder_id || null;
  }

  let builderName: string | null = null;
  let packageName: string | null = null;
  let packageId: string | null = null;
  if (builderId) {
    const [{ data: builder }, { data: assignmentRows }] = await Promise.all([
      supabase.from('builders').select('name').eq('id', builderId).maybeSingle(),
      supabase
        .from('builder_feature_packages')
        .select('package_id, assigned_at')
        .eq('builder_id', builderId)
        .order('assigned_at', { ascending: false, nullsFirst: false })
        .limit(1),
    ]);
    builderName = builder?.name || null;
    const assignment = Array.isArray(assignmentRows) ? assignmentRows[0] : assignmentRows;
    if (assignment?.package_id) {
      packageId = assignment.package_id;
      const { data: pkg } = await supabase
        .from('feature_packages')
        .select('package_name, name')
        .eq('id', assignment.package_id)
        .maybeSingle();
      packageName = pkg?.package_name || pkg?.name || null;
    }
  }

  const { count } = await supabase
    .from('society_admins')
    .select('id', { count: 'exact', head: true })
    .eq('society_id', societyId)
    .is('deactivated_at', null);

  return {
    society,
    builderId,
    builderName,
    packageId,
    packageName,
    adminCount: count || 0,
  };
}
