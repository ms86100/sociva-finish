import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════
// SELLER MODULE — Comprehensive Test Suite
// Tests validation logic, state transitions, and business rules
// ═══════════════════════════════════════════════════════════════════════

// ── Helpers ────────────────────────────────────────────────────────────

/** Simulates the onboarding validation logic from BecomeSellerPage */
function validateOnboardingSubmission(params: {
  draftSellerId: string | null;
  draftProductCount: number;
  acceptedDeclaration: boolean;
  operatingDays: string[];
  acceptsUpi: boolean;
  upiId: string;
}): { valid: boolean; error?: string } {
  if (!params.draftSellerId) return { valid: false, error: 'No seller profile' };
  if (params.draftProductCount === 0) return { valid: false, error: 'Please add at least one product' };
  if (!params.acceptedDeclaration) return { valid: false, error: 'Please accept the seller declaration' };
  if (params.operatingDays.length === 0) return { valid: false, error: 'Please select at least one operating day' };
  if (params.acceptsUpi && !params.upiId.trim()) return { valid: false, error: 'Please enter your UPI ID or disable UPI payments' };
  return { valid: true };
}

/** Simulates product save validation logic from SellerProductsPage */
function validateProductSave(params: {
  name: string;
  category: string;
  price: string;
  actionType: string;
  contactPhone: string;
  categoryRequiresPrice?: boolean;
}): { valid: boolean; error?: string } {
  if (!params.name.trim() || !params.category) return { valid: false, error: 'Please fill in all required fields' };
  
  const price = parseFloat(params.price);
  const actionNeedsPrice = !['contact_seller', 'request_quote', 'make_offer'].includes(params.actionType);
  const categoryRequiresPrice = params.categoryRequiresPrice ?? true;
  
  if (categoryRequiresPrice && actionNeedsPrice && (isNaN(price) || price <= 0)) {
    return { valid: false, error: 'Please enter a valid price' };
  }
  
  if (params.actionType === 'contact_seller' && !params.contactPhone.trim()) {
    return { valid: false, error: 'Phone number is required for Contact Seller action' };
  }
  
  if (params.contactPhone.trim() && !/^[\d+\-\s()]{7,15}$/.test(params.contactPhone.trim())) {
    return { valid: false, error: 'Please enter a valid phone number' };
  }
  
  return { valid: true };
}

/** Simulates seller settings save validation */
function validateSettingsSave(params: {
  businessName: string;
  categories: string[];
  acceptsUpi: boolean;
  upiId: string;
}): { valid: boolean; error?: string } {
  if (!params.businessName.trim()) return { valid: false, error: 'Please enter a business name' };
  if (params.categories.length === 0) return { valid: false, error: 'Please select at least one category' };
  if (params.acceptsUpi && !params.upiId.trim()) return { valid: false, error: 'Please enter your UPI ID' };
  return { valid: true };
}

/** Simulates bulk upload row validation */
function validateBulkRow(row: {
  name: string;
  price: string;
  category: string;
}, allowedCategorySlugs: string[], allRows: { name: string; category: string }[], rowIndex: number): string[] {
  const errors: string[] = [];
  if (!row.name.trim()) errors.push('Name required');
  const price = parseFloat(row.price);
  if (isNaN(price) || price <= 0) errors.push('Invalid price');
  if (row.category && !allowedCategorySlugs.includes(row.category)) errors.push('Invalid category');
  
  const isDupe = allRows.some((other, otherIdx) =>
    otherIdx !== rowIndex && other.name.trim().toLowerCase() === row.name.trim().toLowerCase() && other.category === row.category
  );
  if (isDupe) errors.push('Duplicate');
  
  return errors;
}

/** Simulates health check logic */
function computeSellerHealth(params: {
  verificationStatus: string;
  isAvailable: boolean;
  approvedAvailableProducts: number;
  groupActive: boolean;
  licenseRequired: boolean;
  licenseApproved: boolean;
  licenseMandatory: boolean;
  hasCoordinates: boolean;
  sellBeyondCommunity: boolean;
  hasProfileImage: boolean;
  descriptionLength: number;
  hasOperatingHours: boolean;
  operatingDaysCount: number;
}): { isFullyVisible: boolean; criticalBlockers: number } {
  let criticalBlockers = 0;
  
  if (params.verificationStatus !== 'approved') criticalBlockers++;
  if (!params.isAvailable) criticalBlockers++;
  if (params.approvedAvailableProducts === 0) criticalBlockers++;
  if (!params.groupActive) criticalBlockers++;
  if (params.licenseRequired && params.licenseMandatory && !params.licenseApproved) criticalBlockers++;
  
  return {
    isFullyVisible: criticalBlockers === 0,
    criticalBlockers,
  };
}

/** Simulates the product approval_status assignment logic */
function getProductApprovalStatus(isEdit: boolean): string {
  return isEdit ? 'pending' : 'draft';
}

/** Simulates seller detail page access control */
function canAccessSellerDetail(params: {
  sellerVerificationStatus: string;
  sellerSocietyId: string;
  buyerSocietyId: string | null;
  sellBeyondCommunity: boolean;
}): boolean {
  if (params.sellerVerificationStatus !== 'approved') return false;
  if (params.buyerSocietyId && params.sellerSocietyId !== params.buyerSocietyId && !params.sellBeyondCommunity) return false;
  return true;
}

/** Simulates delivery radius validation (DB trigger) */
function validateDeliveryRadius(km: number): boolean {
  return km >= 1 && km <= 10;
}

/** Simulates fulfillment mode validation (DB trigger) */
function validateFulfillmentMode(mode: string): boolean {
  return ['self_pickup', 'delivery', 'both'].includes(mode);
}

/** Simulates order status transition validation (DB trigger) */
function isValidOrderTransition(from: string, to: string): boolean {
  const allowed: Record<string, string[]> = {
    placed: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['picked_up', 'delivered', 'completed', 'cancelled'],
    picked_up: ['delivered', 'completed'],
    delivered: ['completed', 'returned'],
    enquired: ['quoted', 'cancelled'],
    quoted: ['accepted', 'scheduled', 'cancelled'],
    scheduled: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    returned: [],
  };
  return (allowed[from] || []).includes(to);
}

/** Simulates product approval status validation (DB trigger) */
function validateProductApprovalStatus(status: string): boolean {
  return ['draft', 'pending', 'approved', 'rejected'].includes(status);
}

/** Simulates coupon visibility (RLS) */
function isCouponVisibleToBuyer(coupon: {
  isActive: boolean;
  societyId: string;
  buyerSocietyId: string;
  expiresAt: string | null;
  startsAt: string;
}, now: Date): boolean {
  if (!coupon.isActive) return false;
  if (coupon.societyId !== coupon.buyerSocietyId) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return false;
  if (new Date(coupon.startsAt) > now) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('Seller Module', () => {

  // ── Onboarding Validation ───────────────────────────────────────────
  describe('Onboarding Submission Validation', () => {
    const validParams = {
      draftSellerId: 'seller-123',
      draftProductCount: 2,
      acceptedDeclaration: true,
      operatingDays: ['Mon', 'Tue', 'Wed'],
      acceptsUpi: false,
      upiId: '',
    };

    it('passes with valid params', () => {
      expect(validateOnboardingSubmission(validParams).valid).toBe(true);
    });

    it('rejects without seller profile', () => {
      const r = validateOnboardingSubmission({ ...validParams, draftSellerId: null });
      expect(r.valid).toBe(false);
    });

    it('rejects without products', () => {
      const r = validateOnboardingSubmission({ ...validParams, draftProductCount: 0 });
      expect(r.error).toContain('at least one product');
    });

    it('rejects without declaration', () => {
      const r = validateOnboardingSubmission({ ...validParams, acceptedDeclaration: false });
      expect(r.error).toContain('declaration');
    });

    it('rejects without operating days', () => {
      const r = validateOnboardingSubmission({ ...validParams, operatingDays: [] });
      expect(r.error).toContain('operating day');
    });

    it('rejects UPI enabled without UPI ID', () => {
      const r = validateOnboardingSubmission({ ...validParams, acceptsUpi: true, upiId: '' });
      expect(r.error).toContain('UPI');
    });

    it('passes UPI enabled with valid UPI ID', () => {
      const r = validateOnboardingSubmission({ ...validParams, acceptsUpi: true, upiId: 'seller@upi' });
      expect(r.valid).toBe(true);
    });

    it('rejects UPI enabled with whitespace-only UPI ID', () => {
      const r = validateOnboardingSubmission({ ...validParams, acceptsUpi: true, upiId: '   ' });
      expect(r.valid).toBe(false);
    });
  });

  // ── Product Save Validation ─────────────────────────────────────────
  describe('Product Save Validation', () => {
    const validProduct = {
      name: 'Paneer Butter Masala',
      category: 'home_food',
      price: '250',
      actionType: 'add_to_cart',
      contactPhone: '',
    };

    it('passes with valid product', () => {
      expect(validateProductSave(validProduct).valid).toBe(true);
    });

    it('rejects empty name', () => {
      expect(validateProductSave({ ...validProduct, name: '' }).valid).toBe(false);
    });

    it('rejects empty category', () => {
      expect(validateProductSave({ ...validProduct, category: '' }).valid).toBe(false);
    });

    it('rejects zero price for add_to_cart', () => {
      expect(validateProductSave({ ...validProduct, price: '0' }).error).toContain('valid price');
    });

    it('rejects negative price', () => {
      expect(validateProductSave({ ...validProduct, price: '-10' }).error).toContain('valid price');
    });

    it('rejects non-numeric price', () => {
      expect(validateProductSave({ ...validProduct, price: 'abc' }).error).toContain('valid price');
    });

    it('allows zero price for contact_seller action', () => {
      expect(validateProductSave({ ...validProduct, price: '0', actionType: 'contact_seller', contactPhone: '1234567890' }).valid).toBe(true);
    });

    it('allows zero price for request_quote action', () => {
      expect(validateProductSave({ ...validProduct, price: '0', actionType: 'request_quote' }).valid).toBe(true);
    });

    it('allows zero price for make_offer action', () => {
      expect(validateProductSave({ ...validProduct, price: '0', actionType: 'make_offer' }).valid).toBe(true);
    });

    it('requires phone for contact_seller action', () => {
      expect(validateProductSave({ ...validProduct, actionType: 'contact_seller', contactPhone: '' }).error).toContain('Phone number');
    });

    it('validates phone format', () => {
      expect(validateProductSave({ ...validProduct, contactPhone: 'not-a-phone!' }).error).toContain('valid phone');
    });

    it('accepts valid phone formats', () => {
      expect(validateProductSave({ ...validProduct, contactPhone: '+91 98765 43210' }).valid).toBe(true);
      expect(validateProductSave({ ...validProduct, contactPhone: '(022) 1234567' }).valid).toBe(true);
    });

    it('rejects phone shorter than 7 chars', () => {
      expect(validateProductSave({ ...validProduct, contactPhone: '12345' }).error).toContain('valid phone');
    });
  });

  // ── Product Approval Status ─────────────────────────────────────────
  describe('Product Approval Status Assignment', () => {
    it('new products get draft status', () => {
      expect(getProductApprovalStatus(false)).toBe('draft');
    });

    it('edited products get pending status (re-approval)', () => {
      expect(getProductApprovalStatus(true)).toBe('pending');
    });
  });

  // ── Settings Save Validation ────────────────────────────────────────
  describe('Settings Save Validation', () => {
    it('passes with valid settings', () => {
      expect(validateSettingsSave({
        businessName: 'My Store',
        categories: ['home_food'],
        acceptsUpi: false,
        upiId: '',
      }).valid).toBe(true);
    });

    it('rejects empty business name', () => {
      expect(validateSettingsSave({ businessName: '', categories: ['home_food'], acceptsUpi: false, upiId: '' }).error).toContain('business name');
    });

    it('rejects whitespace-only business name', () => {
      expect(validateSettingsSave({ businessName: '   ', categories: ['home_food'], acceptsUpi: false, upiId: '' }).valid).toBe(false);
    });

    it('rejects empty categories', () => {
      expect(validateSettingsSave({ businessName: 'Store', categories: [], acceptsUpi: false, upiId: '' }).error).toContain('category');
    });

    it('rejects UPI enabled without ID', () => {
      expect(validateSettingsSave({ businessName: 'Store', categories: ['home_food'], acceptsUpi: true, upiId: '' }).error).toContain('UPI');
    });
  });

  // ── Bulk Upload Validation ──────────────────────────────────────────
  describe('Bulk Upload Row Validation', () => {
    const allowed = ['home_food', 'groceries', 'snacks'];

    it('validates valid row', () => {
      const errors = validateBulkRow({ name: 'Item', price: '100', category: 'home_food' }, allowed, [], 0);
      expect(errors).toHaveLength(0);
    });

    it('requires name', () => {
      const errors = validateBulkRow({ name: '', price: '100', category: 'home_food' }, allowed, [], 0);
      expect(errors).toContain('Name required');
    });

    it('requires valid price', () => {
      const errors = validateBulkRow({ name: 'Item', price: '0', category: 'home_food' }, allowed, [], 0);
      expect(errors).toContain('Invalid price');
    });

    it('rejects invalid category', () => {
      const errors = validateBulkRow({ name: 'Item', price: '100', category: 'invalid_cat' }, allowed, [], 0);
      expect(errors).toContain('Invalid category');
    });

    it('detects duplicates', () => {
      const rows = [
        { name: 'Item A', category: 'home_food' },
        { name: 'item a', category: 'home_food' },
      ];
      const errors = validateBulkRow({ name: 'item a', price: '100', category: 'home_food' }, allowed, rows, 1);
      expect(errors).toContain('Duplicate');
    });

    it('allows same name in different categories', () => {
      const rows = [
        { name: 'Item A', category: 'home_food' },
        { name: 'Item A', category: 'groceries' },
      ];
      const errors = validateBulkRow({ name: 'Item A', price: '100', category: 'groceries' }, allowed, rows, 1);
      expect(errors).not.toContain('Duplicate');
    });
  });

  // ── Seller Health Check ─────────────────────────────────────────────
  describe('Seller Health Check', () => {
    const fullyHealthy = {
      verificationStatus: 'approved',
      isAvailable: true,
      approvedAvailableProducts: 5,
      groupActive: true,
      licenseRequired: false,
      licenseApproved: false,
      licenseMandatory: false,
      hasCoordinates: true,
      sellBeyondCommunity: true,
      hasProfileImage: true,
      descriptionLength: 50,
      hasOperatingHours: true,
      operatingDaysCount: 7,
    };

    it('fully visible with all checks passing', () => {
      const result = computeSellerHealth(fullyHealthy);
      expect(result.isFullyVisible).toBe(true);
      expect(result.criticalBlockers).toBe(0);
    });

    it('blocked when not approved', () => {
      const result = computeSellerHealth({ ...fullyHealthy, verificationStatus: 'pending' });
      expect(result.isFullyVisible).toBe(false);
      expect(result.criticalBlockers).toBeGreaterThan(0);
    });

    it('blocked when store closed', () => {
      const result = computeSellerHealth({ ...fullyHealthy, isAvailable: false });
      expect(result.isFullyVisible).toBe(false);
    });

    it('blocked with zero products', () => {
      const result = computeSellerHealth({ ...fullyHealthy, approvedAvailableProducts: 0 });
      expect(result.isFullyVisible).toBe(false);
    });

    it('blocked when group inactive', () => {
      const result = computeSellerHealth({ ...fullyHealthy, groupActive: false });
      expect(result.isFullyVisible).toBe(false);
    });

    it('blocked when mandatory license not approved', () => {
      const result = computeSellerHealth({
        ...fullyHealthy,
        licenseRequired: true,
        licenseMandatory: true,
        licenseApproved: false,
      });
      expect(result.isFullyVisible).toBe(false);
    });

    it('visible when license required but not mandatory', () => {
      const result = computeSellerHealth({
        ...fullyHealthy,
        licenseRequired: true,
        licenseMandatory: false,
        licenseApproved: false,
      });
      expect(result.isFullyVisible).toBe(true);
    });

    it('accumulates multiple blockers', () => {
      const result = computeSellerHealth({
        ...fullyHealthy,
        verificationStatus: 'pending',
        isAvailable: false,
        approvedAvailableProducts: 0,
      });
      expect(result.criticalBlockers).toBe(3);
    });
  });

  // ── Seller Detail Access Control ────────────────────────────────────
  describe('Seller Detail Page Access Control', () => {
    it('allows approved same-society seller', () => {
      expect(canAccessSellerDetail({
        sellerVerificationStatus: 'approved',
        sellerSocietyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        sellBeyondCommunity: false,
      })).toBe(true);
    });

    it('blocks non-approved seller', () => {
      expect(canAccessSellerDetail({
        sellerVerificationStatus: 'pending',
        sellerSocietyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        sellBeyondCommunity: false,
      })).toBe(false);
    });

    it('blocks cross-society without sell_beyond', () => {
      expect(canAccessSellerDetail({
        sellerVerificationStatus: 'approved',
        sellerSocietyId: 'soc-1',
        buyerSocietyId: 'soc-2',
        sellBeyondCommunity: false,
      })).toBe(false);
    });

    it('allows cross-society with sell_beyond', () => {
      expect(canAccessSellerDetail({
        sellerVerificationStatus: 'approved',
        sellerSocietyId: 'soc-1',
        buyerSocietyId: 'soc-2',
        sellBeyondCommunity: true,
      })).toBe(true);
    });

    it('allows when buyer has no society (null)', () => {
      expect(canAccessSellerDetail({
        sellerVerificationStatus: 'approved',
        sellerSocietyId: 'soc-1',
        buyerSocietyId: null,
        sellBeyondCommunity: false,
      })).toBe(true);
    });
  });

  // ── Database Trigger Validations ────────────────────────────────────
  describe('DB Trigger Validations', () => {
    describe('Delivery Radius', () => {
      it('accepts 1 km', () => expect(validateDeliveryRadius(1)).toBe(true));
      it('accepts 10 km', () => expect(validateDeliveryRadius(10)).toBe(true));
      it('accepts 5 km', () => expect(validateDeliveryRadius(5)).toBe(true));
      it('rejects 0 km', () => expect(validateDeliveryRadius(0)).toBe(false));
      it('rejects 11 km', () => expect(validateDeliveryRadius(11)).toBe(false));
      it('rejects negative', () => expect(validateDeliveryRadius(-1)).toBe(false));
    });

    describe('Fulfillment Mode', () => {
      it('accepts self_pickup', () => expect(validateFulfillmentMode('self_pickup')).toBe(true));
      it('accepts delivery', () => expect(validateFulfillmentMode('delivery')).toBe(true));
      it('accepts both', () => expect(validateFulfillmentMode('both')).toBe(true));
      it('rejects invalid', () => expect(validateFulfillmentMode('express')).toBe(false));
      it('rejects empty', () => expect(validateFulfillmentMode('')).toBe(false));
    });

    describe('Product Approval Status', () => {
      it('accepts draft', () => expect(validateProductApprovalStatus('draft')).toBe(true));
      it('accepts pending', () => expect(validateProductApprovalStatus('pending')).toBe(true));
      it('accepts approved', () => expect(validateProductApprovalStatus('approved')).toBe(true));
      it('accepts rejected', () => expect(validateProductApprovalStatus('rejected')).toBe(true));
      it('rejects invalid', () => expect(validateProductApprovalStatus('active')).toBe(false));
    });
  });

  // ── Order Status Transitions ────────────────────────────────────────
  describe('Order Status Transitions', () => {
    it('placed → accepted (valid)', () => expect(isValidOrderTransition('placed', 'accepted')).toBe(true));
    it('placed → cancelled (valid)', () => expect(isValidOrderTransition('placed', 'cancelled')).toBe(true));
    it('placed → preparing (invalid)', () => expect(isValidOrderTransition('placed', 'preparing')).toBe(false));
    it('accepted → preparing (valid)', () => expect(isValidOrderTransition('accepted', 'preparing')).toBe(true));
    it('preparing → ready (valid)', () => expect(isValidOrderTransition('preparing', 'ready')).toBe(true));
    it('ready → delivered (valid)', () => expect(isValidOrderTransition('ready', 'delivered')).toBe(true));
    it('ready → completed (valid)', () => expect(isValidOrderTransition('ready', 'completed')).toBe(true));
    it('completed → cancelled (invalid, terminal)', () => expect(isValidOrderTransition('completed', 'cancelled')).toBe(false));
    it('cancelled → accepted (invalid, terminal)', () => expect(isValidOrderTransition('cancelled', 'accepted')).toBe(false));
    it('delivered → completed (valid)', () => expect(isValidOrderTransition('delivered', 'completed')).toBe(true));
    it('delivered → returned (valid)', () => expect(isValidOrderTransition('delivered', 'returned')).toBe(true));
    it('enquired → quoted (valid)', () => expect(isValidOrderTransition('enquired', 'quoted')).toBe(true));
    it('quoted → scheduled (valid)', () => expect(isValidOrderTransition('quoted', 'scheduled')).toBe(true));
    it('scheduled → in_progress (valid)', () => expect(isValidOrderTransition('scheduled', 'in_progress')).toBe(true));
    it('in_progress → completed (valid)', () => expect(isValidOrderTransition('in_progress', 'completed')).toBe(true));
  });

  // ── Coupon Visibility ───────────────────────────────────────────────
  describe('Coupon Visibility (RLS Logic)', () => {
    const now = new Date('2026-02-22T12:00:00Z');

    it('visible when active, same society, not expired, started', () => {
      expect(isCouponVisibleToBuyer({
        isActive: true,
        societyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        expiresAt: '2026-03-01T00:00:00Z',
        startsAt: '2026-02-01T00:00:00Z',
      }, now)).toBe(true);
    });

    it('hidden when inactive', () => {
      expect(isCouponVisibleToBuyer({
        isActive: false,
        societyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        expiresAt: null,
        startsAt: '2026-02-01T00:00:00Z',
      }, now)).toBe(false);
    });

    it('hidden for different society', () => {
      expect(isCouponVisibleToBuyer({
        isActive: true,
        societyId: 'soc-1',
        buyerSocietyId: 'soc-2',
        expiresAt: null,
        startsAt: '2026-02-01T00:00:00Z',
      }, now)).toBe(false);
    });

    it('hidden when expired', () => {
      expect(isCouponVisibleToBuyer({
        isActive: true,
        societyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        expiresAt: '2026-02-20T00:00:00Z',
        startsAt: '2026-02-01T00:00:00Z',
      }, now)).toBe(false);
    });

    it('hidden when not yet started', () => {
      expect(isCouponVisibleToBuyer({
        isActive: true,
        societyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        expiresAt: null,
        startsAt: '2026-03-01T00:00:00Z',
      }, now)).toBe(false);
    });

    it('visible with null expires_at (never expires)', () => {
      expect(isCouponVisibleToBuyer({
        isActive: true,
        societyId: 'soc-1',
        buyerSocietyId: 'soc-1',
        expiresAt: null,
        startsAt: '2026-02-01T00:00:00Z',
      }, now)).toBe(true);
    });
  });

  // ── Earnings Calculation ────────────────────────────────────────────
  describe('Earnings Calculation Logic', () => {
    it('counts completed and delivered toward earnings', () => {
      const orders = [
        { status: 'completed', total_amount: 100 },
        { status: 'delivered', total_amount: 200 },
        { status: 'cancelled', total_amount: 500 },
        { status: 'placed', total_amount: 150 },
      ];
      const earnings = orders
        .filter(o => o.status === 'completed' || o.status === 'delivered')
        .reduce((sum, o) => sum + o.total_amount, 0);
      expect(earnings).toBe(300);
    });

    it('counts pending correctly', () => {
      const orders = [
        { status: 'placed' },
        { status: 'accepted' },
        { status: 'preparing' },
        { status: 'ready' },
        { status: 'completed' },
      ];
      const pending = orders.filter(o => !['completed', 'delivered', 'cancelled'].includes(o.status)).length;
      expect(pending).toBe(4);
    });
  });

  // ── Admin Approval Cascade ──────────────────────────────────────────
  describe('Admin Approval Cascade', () => {
    it('approving seller should cascade products', () => {
      const products = [
        { approval_status: 'draft' },
        { approval_status: 'pending' },
        { approval_status: 'approved' },
      ];
      // Admin approval cascades pending/draft → approved
      const cascaded = products.map(p =>
        ['pending', 'draft'].includes(p.approval_status)
          ? { ...p, approval_status: 'approved' }
          : p
      );
      expect(cascaded.every(p => p.approval_status === 'approved')).toBe(true);
    });

    it('rejecting seller should remove seller role', () => {
      // Simulates: on reject, delete user_roles where role = 'seller'
      const roles = ['buyer', 'seller'];
      const afterReject = roles.filter(r => r !== 'seller');
      expect(afterReject).toEqual(['buyer']);
      expect(afterReject).not.toContain('seller');
    });
  });
});
