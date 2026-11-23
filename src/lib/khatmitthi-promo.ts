/** Client-side config helpers for Khatmitthi WhatsApp promo autopilot. */

export type PromoMode = 'off' | 'shadow' | 'live';

export type KhatmitthiPromoConfig = {
  mode: PromoMode;
  interval_minutes: number;
  timezone: string;
  seller_id: string;
  coupon_code: string;
  offer_label: string;
  recipients: string[];
  android_url: string;
  ios_url: string;
  web_url: string;
  provider: 'evolution_go' | 'meta';
  meta_template_name: string | null;
  quiet_hours_start_ist: number;
  quiet_hours_end_ist: number;
  prefer_real_product_photos: boolean;
  society_name: string;
};

export const DEFAULT_KHATMITHI_PROMO_CONFIG: KhatmitthiPromoConfig = {
  mode: 'shadow',
  interval_minutes: 40,
  timezone: 'Asia/Kolkata',
  seller_id: 'a058a92e-11b7-4e37-ade1-e73132d6e578',
  coupon_code: 'KHATMITTHI50',
  offer_label: 'FLAT 50% OFF',
  recipients: ['919535115316', '919187351014'],
  android_url: 'https://play.google.com/store/apps/details?id=app.sociva.community&hl=en_IN',
  ios_url: 'https://apps.apple.com/in/app/sociva/id6759218504',
  web_url: 'https://sociva.in',
  provider: 'evolution_go',
  meta_template_name: null,
  quiet_hours_start_ist: 0,
  quiet_hours_end_ist: 7,
  prefer_real_product_photos: false,
  society_name: 'Shriram Greenfield',
};

export function mergeKhatmitthiPromoConfig(raw: unknown): KhatmitthiPromoConfig {
  const base = { ...DEFAULT_KHATMITHI_PROMO_CONFIG };
  if (!raw || typeof raw !== 'object') return base;
  const v = raw as Record<string, unknown>;
  if (v.mode === 'off' || v.mode === 'shadow' || v.mode === 'live') base.mode = v.mode;
  if (typeof v.interval_minutes === 'number' && v.interval_minutes >= 10) {
    base.interval_minutes = Math.floor(v.interval_minutes);
  }
  if (typeof v.coupon_code === 'string' && v.coupon_code.trim()) {
    base.coupon_code = v.coupon_code.trim().toUpperCase();
  }
  if (typeof v.offer_label === 'string' && v.offer_label.trim()) {
    base.offer_label = v.offer_label.trim().replace(/\u2014|\u2013/g, '-');
  }
  if (Array.isArray(v.recipients)) {
    const phones = v.recipients
      .map((p) => {
        let digits = String(p || '').replace(/\D/g, '');
        if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
        if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
          digits = `91${digits.slice(1)}`;
        }
        return digits.length >= 11 && digits.length <= 15 ? digits : '';
      })
      .filter(Boolean);
    if (phones.length) base.recipients = [...new Set(phones)];
  }
  if (typeof v.meta_template_name === 'string' && v.meta_template_name.trim()) {
    base.meta_template_name = v.meta_template_name.trim();
  } else if (v.meta_template_name === null) {
    base.meta_template_name = null;
  }
  if (typeof v.prefer_real_product_photos === 'boolean') {
    base.prefer_real_product_photos = v.prefer_real_product_photos;
  }
  if (typeof v.society_name === 'string' && v.society_name.trim()) {
    base.society_name = v.society_name.trim().replace(/\u2014|\u2013/g, '-');
  }
  return base;
}
