// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface SellerHealthCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  message: string;
  actionLabel?: string;
  actionRoute?: string;
  group: 'critical' | 'products' | 'discovery' | 'quality';
}

export interface SellerHealthData {
  checks: SellerHealthCheck[];
  passCount: number;
  totalChecks: number;
  isFullyVisible: boolean;
  criticalBlockers: number;
}

export function useSellerHealth(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-health', sellerId],
    queryFn: async (): Promise<SellerHealthData> => {
      if (!sellerId) return { checks: [], passCount: 0, totalChecks: 0, isFullyVisible: false, criticalBlockers: 0 };

      const [profileRes, productRes, licenseRes, categoryRes, groupRes] = await Promise.all([
        supabase
          .from('seller_profiles')
          .select('verification_status, is_available, sell_beyond_community, delivery_radius_km, primary_group, categories, society_id, description, profile_image_url, cover_image_url, availability_start, availability_end, operating_days, latitude, longitude, societies:societies!seller_profiles_society_id_fkey(latitude, longitude)')
          .eq('id', sellerId)
          .single(),
        supabase
          .from('products')
          .select('id, approval_status, is_available, image_url, price, category')
          .eq('seller_id', sellerId),
        supabase
          .from('seller_licenses')
          .select('status, group_id, parent_groups!inner(slug, requires_license, license_mandatory)')
          .eq('seller_id', sellerId),
        supabase
          .from('category_config')
          .select('category, is_active, display_name'),
        supabase
          .from('parent_groups')
          .select('slug, is_active, name'),
      ]);

      const profile = profileRes.data as any;
      const products = (productRes.data || []) as any[];
      const licenses = (licenseRes.data || []) as any[];
      const categories = (categoryRes.data || []) as any[];
      const parentGroups = (groupRes.data || []) as any[];

      if (!profile) return { checks: [], passCount: 0, totalChecks: 0, isFullyVisible: false, criticalBlockers: 0 };

      const checks: SellerHealthCheck[] = [];

      // ═══════════════════════════════════════
      // CRITICAL — Hard visibility gates
      // ═══════════════════════════════════════

      // C1: Store approval
      const verStatus = profile.verification_status;
      if (verStatus === 'approved') {
        checks.push({ key: 'store_verified', label: 'Store approved', status: 'pass', message: 'Your store is live and approved.', group: 'critical' });
      } else if (verStatus === 'pending') {
        checks.push({ key: 'store_verified', label: 'Store approval pending', status: 'warn', message: 'Your store is under admin review. Buyers cannot see it yet.', group: 'critical' });
      } else if (verStatus === 'rejected') {
        checks.push({ key: 'store_verified', label: 'Store rejected', status: 'fail', message: 'Your store was rejected. Edit and resubmit for review.', actionLabel: 'Edit Store', actionRoute: '/seller/settings', group: 'critical' });
      } else {
        checks.push({ key: 'store_verified', label: 'Store in draft', status: 'fail', message: 'Your store hasn\'t been submitted yet.', actionLabel: 'Complete Setup', actionRoute: '/become-seller', group: 'critical' });
      }

      // C2: Store availability toggle
      if (profile.is_available) {
        checks.push({ key: 'store_available', label: 'Store is open', status: 'pass', message: 'Buyers can see your store.', group: 'critical' });
      } else {
        checks.push({ key: 'store_available', label: 'Store is closed', status: 'fail', message: 'Your store is marked as closed. Toggle it open to become visible.', group: 'critical' });
      }

      // C3: At least one approved & available product
      const approvedAvailable = products.filter(p => p.approval_status === 'approved' && p.is_available);
      if (approvedAvailable.length > 0) {
        checks.push({ key: 'has_products', label: `${approvedAvailable.length} product(s) live`, status: 'pass', message: `${approvedAvailable.length} approved product(s) visible to buyers.`, group: 'critical' });
      } else {
        checks.push({ key: 'has_products', label: 'No live products', status: 'fail', message: 'You need at least 1 approved and available product to appear in buyer discovery.', actionLabel: 'Manage Products', actionRoute: '/seller/products', group: 'critical' });
      }

      // C4: Parent group active
      if (profile.primary_group) {
        const pg = parentGroups.find((g: any) => g.slug === profile.primary_group);
        if (pg && !pg.is_active) {
          checks.push({ key: 'group_active', label: `Category group "${pg.name}" disabled`, status: 'fail', message: 'Your primary category group has been disabled by the admin. Your products cannot be listed. Contact support.', group: 'critical' });
        } else if (pg) {
          checks.push({ key: 'group_active', label: 'Category group active', status: 'pass', message: `"${pg.name}" is active.`, group: 'critical' });
        }
      }

      // C5: License check (if mandatory)
      if (profile.primary_group) {
        const pg = parentGroups.find((g: any) => g.slug === profile.primary_group);
        const relevantLicense = licenses.find((l: any) => l.parent_groups?.slug === profile.primary_group && l.parent_groups?.requires_license);
        const isMandatory = relevantLicense?.parent_groups?.license_mandatory === true;

        if (relevantLicense) {
          if (relevantLicense.status === 'approved') {
            checks.push({ key: 'license', label: 'License approved', status: 'pass', message: 'Your business license is verified.', group: 'critical' });
          } else if (relevantLicense.status === 'pending') {
            checks.push({ key: 'license', label: 'License under review', status: 'warn', message: isMandatory ? 'Your license is being reviewed. Products cannot go live until approved.' : 'Your license is being reviewed.', group: 'critical' });
          } else {
            checks.push({ key: 'license', label: 'License rejected', status: 'fail', message: 'Your license was rejected. Re-upload a valid document.', actionLabel: 'Upload License', actionRoute: '/become-seller', group: 'critical' });
          }
        } else {
          // Check if license is required but not submitted
          const groupNeedsLicense = parentGroups.find((g: any) => g.slug === profile.primary_group);
          if (groupNeedsLicense) {
            // Query parent_groups directly for requires_license
            const pgDetail = parentGroups.find((g: any) => g.slug === profile.primary_group);
            // We don't have requires_license on the groups query above, so check licenses array
            // If no license record and there are products stuck, warn
          }
        }
      }

      // ═══════════════════════════════════════
      // PRODUCTS — Detailed product health
      // ═══════════════════════════════════════

      const drafts = products.filter(p => p.approval_status === 'draft');
      const pending = products.filter(p => p.approval_status === 'pending');
      const rejected = products.filter(p => p.approval_status === 'rejected');
      const noImage = products.filter(p => p.approval_status !== 'draft' && !p.image_url);

      if (drafts.length > 0) {
        checks.push({ key: 'draft_products', label: `${drafts.length} draft product(s)`, status: 'warn', message: `${drafts.length} product(s) are in draft. Submit them for admin approval.`, actionLabel: 'Submit Products', actionRoute: '/seller/products', group: 'products' });
      }

      if (pending.length > 0) {
        checks.push({ key: 'pending_products', label: `${pending.length} product(s) under review`, status: 'info', message: `${pending.length} product(s) are awaiting admin approval.`, group: 'products' });
      }

      if (rejected.length > 0) {
        checks.push({ key: 'rejected_products', label: `${rejected.length} product(s) rejected`, status: 'warn', message: `${rejected.length} product(s) were rejected. Edit and resubmit them.`, actionLabel: 'Fix Products', actionRoute: '/seller/products', group: 'products' });
      }

      // Product images missing
      if (noImage.length > 0) {
        checks.push({ key: 'product_images', label: `${noImage.length} product(s) without images`, status: 'warn', message: 'Products without images get significantly fewer views. Add images to improve visibility.', actionLabel: 'Add Images', actionRoute: '/seller/products', group: 'products' });
      }

      // Category active check for products
      const sellerCategories = new Set(products.map(p => p.category));
      const disabledCats = Array.from(sellerCategories).filter(cat => {
        const cfg = categories.find((c: any) => c.category === cat);
        return cfg && !cfg.is_active;
      });
      if (disabledCats.length > 0) {
        const names = disabledCats.map(cat => {
          const cfg = categories.find((c: any) => c.category === cat);
          return cfg?.display_name || cat;
        });
        checks.push({ key: 'category_active', label: `${disabledCats.length} category(ies) disabled`, status: 'fail', message: `Products in "${names.join(', ')}" are hidden because the category has been disabled by the admin.`, group: 'products' });
      }

      // ═══════════════════════════════════════
      // DISCOVERY — Location & cross-society reach
      // ═══════════════════════════════════════

      const society = profile.societies;
      const hasSellerCoords = profile.latitude != null && profile.longitude != null;
      const hasSocietyCoords = society?.latitude != null && society?.longitude != null;
      // seller_type is not guaranteed in older DBs; default to society_resident behavior
      const isCommercial = false;

      if (hasSellerCoords || hasSocietyCoords) {
        checks.push({ key: 'store_location', label: 'Store location configured', status: 'pass', message: hasSellerCoords ? 'Your store has direct coordinates for discovery.' : 'Location derived from your society.', group: 'discovery' });
      } else {
        checks.push({ key: 'store_location', label: 'Store location not configured', status: 'fail', message: 'Buyers cannot find you without a location. Set your store coordinates.', actionLabel: 'Set Store Location', actionRoute: '#set-store-location', group: 'discovery' });
      }

      if (isCommercial) {
        checks.push({ key: 'cross_society', label: 'Commercial seller', status: 'pass', message: 'Visible to all buyers within your delivery radius.', group: 'discovery' });
      } else if (profile.sell_beyond_community) {
        checks.push({ key: 'cross_society', label: 'Cross-society selling enabled', status: 'pass', message: `Visible to buyers within ${profile.delivery_radius_km || 5} km.`, group: 'discovery' });
      } else {
        checks.push({ key: 'cross_society', label: 'Cross-society selling disabled', status: 'info', message: 'Enable "Sell beyond community" to reach buyers in nearby societies.', actionLabel: 'Update Settings', actionRoute: '/seller/settings', group: 'discovery' });
      }

      // ═══════════════════════════════════════
      // QUALITY — Profile completeness & trust
      // ═══════════════════════════════════════

      if (profile.profile_image_url) {
        checks.push({ key: 'profile_image', label: 'Store logo set', status: 'pass', message: 'Your store has a logo for buyer recognition.', group: 'quality' });
      } else {
        checks.push({ key: 'profile_image', label: 'No store logo', status: 'warn', message: 'Add a store logo to build trust and recognition with buyers.', actionLabel: 'Add Logo', actionRoute: '/seller/settings', group: 'quality' });
      }

      if (profile.description && profile.description.trim().length >= 10) {
        checks.push({ key: 'description', label: 'Store description set', status: 'pass', message: 'Your store has a description.', group: 'quality' });
      } else {
        checks.push({ key: 'description', label: 'No store description', status: 'warn', message: 'Add a description to help buyers understand what you sell.', actionLabel: 'Add Description', actionRoute: '/seller/settings', group: 'quality' });
      }

      if (profile.availability_start && profile.availability_end) {
        checks.push({ key: 'operating_hours', label: 'Operating hours set', status: 'pass', message: `${profile.availability_start} – ${profile.availability_end}`, group: 'quality' });
      } else {
        checks.push({ key: 'operating_hours', label: 'Operating hours not set', status: 'warn', message: 'Set your operating hours so buyers know when you\'re open.', actionLabel: 'Set Hours', actionRoute: '/seller/settings', group: 'quality' });
      }

      if (profile.operating_days && profile.operating_days.length > 0) {
        checks.push({ key: 'operating_days', label: 'Operating days set', status: 'pass', message: `${profile.operating_days.length} days/week`, group: 'quality' });
      } else {
        checks.push({ key: 'operating_days', label: 'No operating days set', status: 'fail', message: 'Your store appears closed — no operating days selected. Buyers cannot see you.', actionLabel: 'Set Days', actionRoute: '/seller/settings', group: 'quality' });
      }

      // ═══════════════════════════════════════
      // Summary
      // ═══════════════════════════════════════

      const criticalChecks = checks.filter(c => c.group === 'critical');
      const criticalBlockers = criticalChecks.filter(c => c.status === 'fail' || c.status === 'warn').length;
      const passCount = criticalChecks.filter(c => c.status === 'pass').length;
      const isFullyVisible = criticalChecks.every(c => c.status === 'pass' || c.status === 'info');

      return { checks, passCount, totalChecks: criticalChecks.length, isFullyVisible, criticalBlockers };
    },
    enabled: !!sellerId,
    staleTime: jitteredStaleTime(30_000),
  });
}
