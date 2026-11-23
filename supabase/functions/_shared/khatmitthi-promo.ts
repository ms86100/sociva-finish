/** Khatmitthi WhatsApp promo creative engine (operator inbox, Meta Cloud API). */

export type PromoMode = "off" | "shadow" | "live";

export type PromoAngle =
  | "emotional_homemade"
  | "discount_50"
  | "taste_focused"
  | "family_together"
  | "evening_cravings"
  | "meal_special"
  | "seller_invitation"
  | "limited_time"
  | "neighbourhood"
  | "exciting_promo";

export type PromoProduct = {
  id: string;
  name: string;
  price: number | null;
  imageUrl: string | null;
  category: string | null;
};

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
  provider: "evolution_go" | "meta";
  meta_template_name: string | null;
  quiet_hours_start_ist: number;
  quiet_hours_end_ist: number;
  prefer_real_product_photos: boolean;
  /** Society lock for promo copy and posters. */
  society_name: string;
};

export const KHATMITHI_SELLER_ID = "a058a92e-11b7-4e37-ade1-e73132d6e578";

export const PROMO_ANGLES: PromoAngle[] = [
  "emotional_homemade",
  "discount_50",
  "taste_focused",
  "family_together",
  "evening_cravings",
  "meal_special",
  "seller_invitation",
  "limited_time",
  "neighbourhood",
  "exciting_promo",
];

export const DEFAULT_KHATMITHI_PROMO_CONFIG: KhatmitthiPromoConfig = {
  mode: "shadow",
  interval_minutes: 40,
  timezone: "Asia/Kolkata",
  seller_id: KHATMITHI_SELLER_ID,
  coupon_code: "KHATMITTHI50",
  offer_label: "FLAT 50% OFF",
  recipients: ["919535115316", "919187351014"],
  android_url: "https://play.google.com/store/apps/details?id=app.sociva.community&hl=en_IN",
  ios_url: "https://apps.apple.com/in/app/sociva/id6759218504",
  web_url: "https://sociva.in",
  provider: "evolution_go",
  meta_template_name: null,
  quiet_hours_start_ist: 0,
  quiet_hours_end_ist: 7,
  prefer_real_product_photos: false,
  society_name: "Shriram Greenfield",
};

export function stripFancyDashes(text: string): string {
  return String(text || "")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2012/g, "-")
    .replace(/\u2212/g, "-");
}

export function mergeKhatmitthiPromoConfig(raw: unknown): KhatmitthiPromoConfig {
  const base = { ...DEFAULT_KHATMITHI_PROMO_CONFIG };
  if (!raw || typeof raw !== "object") return base;
  const v = raw as Record<string, unknown>;

  if (v.mode === "off" || v.mode === "shadow" || v.mode === "live") base.mode = v.mode;
  if (typeof v.interval_minutes === "number" && v.interval_minutes >= 10) {
    base.interval_minutes = Math.floor(v.interval_minutes);
  }
  if (typeof v.timezone === "string" && v.timezone.trim()) base.timezone = v.timezone.trim();
  if (typeof v.seller_id === "string" && v.seller_id.trim()) base.seller_id = v.seller_id.trim();
  if (typeof v.coupon_code === "string" && v.coupon_code.trim()) {
    base.coupon_code = v.coupon_code.trim().toUpperCase();
  }
  if (typeof v.offer_label === "string" && v.offer_label.trim()) {
    base.offer_label = stripFancyDashes(v.offer_label.trim());
  }
  if (Array.isArray(v.recipients)) {
    const phones = v.recipients
      .map((p) => normalizeWhatsAppPhone(String(p || "")))
      .filter((p): p is string => !!p);
    if (phones.length) base.recipients = [...new Set(phones)];
  }
  if (typeof v.android_url === "string" && v.android_url.startsWith("http")) base.android_url = v.android_url;
  if (typeof v.ios_url === "string" && v.ios_url.startsWith("http")) base.ios_url = v.ios_url;
  if (typeof v.web_url === "string" && v.web_url.startsWith("http")) base.web_url = v.web_url;
  if (typeof v.meta_template_name === "string" && v.meta_template_name.trim()) {
    base.meta_template_name = v.meta_template_name.trim();
  } else if (v.meta_template_name === null) {
    base.meta_template_name = null;
  }
  if (typeof v.quiet_hours_start_ist === "number") {
    base.quiet_hours_start_ist = Math.max(0, Math.min(23, Math.floor(v.quiet_hours_start_ist)));
  }
  if (typeof v.quiet_hours_end_ist === "number") {
    base.quiet_hours_end_ist = Math.max(0, Math.min(23, Math.floor(v.quiet_hours_end_ist)));
  }
  if (typeof v.prefer_real_product_photos === "boolean") {
    base.prefer_real_product_photos = v.prefer_real_product_photos;
  }
  if (typeof v.society_name === "string" && v.society_name.trim()) {
    base.society_name = stripFancyDashes(v.society_name.trim());
  }
  if (v.provider === "evolution_go" || v.provider === "meta") base.provider = v.provider;
  else base.provider = "evolution_go";
  return base;
}

export function istParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday || ""),
  };
}

export function inQuietHours(config: KhatmitthiPromoConfig, now = new Date()): boolean {
  const { hour } = istParts(now);
  const start = config.quiet_hours_start_ist;
  const end = config.quiet_hours_end_ist;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function pickAngle(recentAngles: string[], now = new Date()): PromoAngle {
  const { hour } = istParts(now);
  const preferred: PromoAngle[] = [];
  if (hour >= 16 && hour <= 21) preferred.push("evening_cravings", "meal_special");
  if (hour >= 10 && hour <= 14) preferred.push("meal_special", "taste_focused");
  preferred.push("discount_50", "seller_invitation", "emotional_homemade");

  const recent = new Set(recentAngles.slice(0, 6));
  const pool = [...preferred, ...PROMO_ANGLES].filter((a, i, arr) => arr.indexOf(a) === i);
  const fresh = pool.filter((a) => !recent.has(a));
  const use = fresh.length ? fresh : pool;
  const idx = Math.floor((now.getTime() / 60_000) % use.length);
  return use[idx]!;
}

export function pickProduct(
  products: PromoProduct[],
  recentProductIds: string[],
): PromoProduct | null {
  const withPhoto = products.filter((p) => !!p.imageUrl);
  const pool = withPhoto.length ? withPhoto : products;
  if (!pool.length) return null;
  const recent = new Set(recentProductIds.slice(0, 8));
  const fresh = pool.filter((p) => !recent.has(p.id));
  const use = fresh.length ? fresh : pool;
  const idx = Math.abs(hashString(use.map((p) => p.id).join("|") + String(Date.now())).charCodeAt(0)) % use.length;
  return use[idx] || use[0] || null;
}

export function shouldUseRealProductPhoto(
  config: KhatmitthiPromoConfig,
  angle: PromoAngle,
  product: PromoProduct | null,
): boolean {
  if (!config.prefer_real_product_photos || !product?.imageUrl) return false;
  // Branded posters carry society + 50% OFF typography for forwarding.
  if (
    angle === "discount_50" ||
    angle === "exciting_promo" ||
    angle === "limited_time" ||
    angle === "neighbourhood" ||
    angle === "meal_special"
  ) {
    return false;
  }
  return true;
}

export function angleBrief(angle: PromoAngle): string {
  switch (angle) {
    case "emotional_homemade":
      return "Warm homemade food for Shriram Greenfield neighbours, heartfelt kitchen tone";
    case "discount_50":
      return "Urgent FLAT 50% OFF for Shriram Greenfield - make people rush to claim it";
    case "taste_focused":
      return "Crave-heavy taste and aroma that makes Greenfield residents order now";
    case "family_together":
      return "Family lunch or dinner at Shriram Greenfield with homemade comfort";
    case "evening_cravings":
      return "Evening hunger at Greenfield - comfort food ready now";
    case "meal_special":
      return "Lunch or dinner special for Shriram Greenfield towers only";
    case "seller_invitation":
      return "Personal invitation from Khatmitthi to Shriram Greenfield neighbours";
    case "limited_time":
      return "Today's 50% offer for Greenfield - grab it before the kitchen slows";
    case "neighbourhood":
      return "Shriram Greenfield community kitchen support on Sociva";
    case "exciting_promo":
      return "High-energy 50% OFF announcement for Shriram Greenfield residents";
  }
}

export function buildCaptionFallback(opts: {
  angle: PromoAngle;
  productName: string;
  coupon: string;
  offerLabel: string;
  androidUrl: string;
  iosUrl: string;
  webUrl: string;
  societyName?: string;
}): string {
  const dish = opts.productName || "homemade favourites";
  const society = opts.societyName || "Shriram Greenfield";
  const openers: Record<PromoAngle, string> = {
    emotional_homemade: `Shriram Greenfield neighbours - ${dish} from our kitchen, made with love.`,
    discount_50: `${society} alert: ${opts.offerLabel} on Khatmitthi today. Do not miss this.`,
    taste_focused: `${society}, craving hits hard? Our ${dish} is pure Bihar comfort.`,
    family_together: `${society} families - gather for ${dish} from Khatmitthi tonight.`,
    evening_cravings: `${society} evening hunger? ${dish} is ready. Order before it goes.`,
    meal_special: `${society} lunch and dinner sorted - order ${dish} on Sociva now.`,
    seller_invitation: `Hi ${society} - this is Khatmitthi. Come try our ${dish} today.`,
    limited_time: `${society} only today: ${opts.offerLabel}. Grab ${dish} before we slow down.`,
    neighbourhood: `${society} neighbours, support your local kitchen - fresh ${dish} on Sociva.`,
    exciting_promo: `${society}! ${opts.offerLabel} on Khatmitthi. Code ${opts.coupon}. Rush now.`,
  };

  return stripFancyDashes(
    [
      "WELCOME TO KHATMITTHI!",
      `For ${society} residents only`,
      "",
      openers[opts.angle],
      "",
      `Get ${opts.offerLabel} on your today's order.`,
      `Use Coupon Code: ${opts.coupon}`,
      "",
      "Hurry - claim your 50% off and order now!",
      "",
      "Order on Sociva:",
      `Android: ${opts.androidUrl}`,
      `iOS: ${opts.iosUrl}`,
      `Web: ${opts.webUrl}`,
    ].join("\n"),
  );
}

export function buildCopyPrompt(opts: {
  angle: PromoAngle;
  productName: string;
  price: number | null;
  coupon: string;
  offerLabel: string;
  androidUrl: string;
  iosUrl: string;
  webUrl: string;
  recentCaptions: string[];
  societyName?: string;
}): string {
  const society = opts.societyName || "Shriram Greenfield";
  const recent = opts.recentCaptions.slice(0, 5).map((c, i) => `${i + 1}. ${c.slice(0, 180)}`).join("\n") || "(none)";
  return `You write short WhatsApp food promos for Khatmitthi, a Bihar-style neighbourhood cloud kitchen on Sociva.

Audience lock: ONLY for ${society} residents. Mention "${society}" clearly in the message. Do not name any other society, city area, or tower complex.
Voice: personal seller talking to ${society} neighbours. Warm, urgent, irresistible - make people rush to grab the deal. Never corporate.
Goal: make readers feel they must order NOW before the ${opts.offerLabel} moment passes.
Angle: ${opts.angle} - ${angleBrief(opts.angle)}
Featured dish: ${opts.productName}${opts.price != null ? ` (menu price about Rs ${opts.price})` : ""}
Must keep offer exactly: ${opts.offerLabel}
Must keep coupon exactly: ${opts.coupon}
Must include Sociva order links:
Android: ${opts.androidUrl}
iOS: ${opts.iosUrl}
Web: ${opts.webUrl}

Rules:
- Start with a short punchy first line under 60 characters (this becomes the poster headline). Prefer urgency + dish or Greenfield.
- WhatsApp-friendly, easy to forward (max ~900 characters)
- Fresh wording every time. Do not copy recent captions.
- No em dash or en dash characters. Use plain hyphen "-" if needed.
- No markdown. Light emoji ok (max 4).
- Strong CTA: order now / grab 50% / claim your coupon today.
- Do not invent other societies. Only ${society}.
- Do not claim the dish photo is AI. Keep focus on ordering.

Recent captions to avoid repeating:
${recent}

Return ONLY the WhatsApp message text.`;
}

export function buildImagePrompt(opts: {
  angle: PromoAngle;
  productName: string;
  coupon: string;
  offerLabel: string;
  headline: string;
  societyName?: string;
}): string {
  const society = opts.societyName || "Shriram Greenfield";
  return `Create a premium Indian food marketing poster (square 1:1).
Brand: KHATMITTHI
Society lock text on image: ${society} only
Offer text on image: ${opts.offerLabel}
Coupon text on image: ${opts.coupon}
Short headline on image: ${opts.headline}
Featured dish inspiration: ${opts.productName}
Angle: ${angleBrief(opts.angle)}

Must clearly show: KHATMITTHI, ${society}, ${opts.offerLabel}, and ${opts.coupon}.
Make it look urgent and irresistible so residents rush to order.
Visual style: warm natural light, authentic homemade Indian food mood, appetizing textures, clean elegant composition, professional advertising quality.
Typography: bold, attractive, readable, not cluttered.
This is clearly a promotional creative graphic, not a claim of a real restaurant photograph.
No watermark, no QR code, no fake App Store badges. No other society names.`;
}

export function normalizeWhatsAppPhone(raw: string): string | null {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  // Local Indian mobile -> E.164 without plus
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) {
    digits = `91${digits.slice(1)}`;
  }
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

export function extractHeadline(caption: string): string {
  const lines = stripFancyDashes(caption)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const skip =
    /coupon|android|ios|web:|http|flat 50|welcome to khatmitthi|place your order|looking forward|order on sociva|use coupon/i;
  for (const line of lines) {
    if (skip.test(line)) continue;
    const cleaned = line.replace(/^[^\w\u0900-\u097F]+/, "").trim();
    if (!cleaned) continue;
    // Prefer first sentence from opening paragraph
    const sentence = cleaned.match(/^(.{12,70}?[.!?])(?:\s|$)/);
    if (sentence?.[1]) return sentence[1].trim().slice(0, 72);
    if (cleaned.length >= 12 && cleaned.length <= 72) return cleaned.slice(0, 72);
    if (cleaned.length > 72) {
      const clipped = cleaned.slice(0, 70);
      const cut = clipped.lastIndexOf(" ");
      return (cut > 20 ? clipped.slice(0, cut) : clipped).trim();
    }
  }
  return "Taste of home, today";
}

export function hashString(input: string): string {
  let h = 2166136261;
  const s = String(input || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function normalizeCaption(caption: string, config: KhatmitthiPromoConfig): string {
  let text = stripFancyDashes(caption).trim();
  if (!text) {
    text = buildCaptionFallback({
      angle: "discount_50",
      productName: "homemade favourites",
      coupon: config.coupon_code,
      offerLabel: config.offer_label,
      androidUrl: config.android_url,
      iosUrl: config.ios_url,
      webUrl: config.web_url,
      societyName: config.society_name,
    });
  }
  if (!new RegExp(config.society_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
    text = `${config.society_name} neighbours -\n${text}`;
  }
  if (!text.includes(config.coupon_code)) {
    text += `\n\nUse Coupon Code: ${config.coupon_code}`;
  }
  if (!/FLAT 50% OFF|50% OFF/i.test(text)) {
    text += `\nGet ${config.offer_label} on your today's order.`;
  }
  if (!/hurry|grab|rush|claim|order now|before/i.test(text)) {
    text += `\nHurry - claim your 50% off and order now!`;
  }
  if (!text.includes(config.android_url)) {
    text += `\n\nAndroid: ${config.android_url}`;
  }
  if (!text.includes(config.ios_url)) {
    text += `\niOS: ${config.ios_url}`;
  }
  if (!text.includes(config.web_url)) {
    text += `\nWeb: ${config.web_url}`;
  }
  return stripFancyDashes(text).slice(0, 1000);
}
