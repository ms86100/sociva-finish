import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildCaptionFallback,
  buildCopyPrompt,
  buildImagePrompt,
  extractHeadline,
  hashString,
  inQuietHours,
  istParts,
  mergeKhatmitthiPromoConfig,
  normalizeCaption,
  normalizeWhatsAppPhone,
  pickAngle,
  pickProduct,
  shouldUseRealProductPhoto,
  stripFancyDashes,
  type PromoProduct,
} from "../_shared/khatmitthi-promo.ts";
import { evolutionGoSendImage, evolutionGoSendText } from "../_shared/evolution-go.ts";
import { sendViaActiveWhatsAppProvider } from "../_shared/whatsapp-provider.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import {
  isCronSecretRequest,
  isServiceRoleRequest,
} from "../_shared/worker-auth.ts";

/* cors: use corsHeadersFor(req) */

function makeJson(corsHeaders: Record<string, string>) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function normalizePhone(raw: string): string | null {
  return normalizeWhatsAppPhone(raw);
}

/** Same pipe as order alerts: Evolution Go when active, else Meta. */
async function deliverPromo(opts: {
  phone: string;
  caption: string;
  imageUrl: string;
}) {
  const phone = opts.phone;
  const caption = opts.caption.slice(0, 1024);
  const imageUrl = opts.imageUrl;

  // Image+caption via Evolution Go /send/media (same WA session as order alerts).
  const imageTry = await evolutionGoSendImage({
    number: phone,
    imageUrl,
    caption,
  });
  if (imageTry.success) {
    return {
      success: true,
      code: imageTry.code,
      provider: "evolution_go" as const,
      providerMessageId: imageTry.providerMessageId,
      error: undefined as string | undefined,
      used_image: true,
      elapsedMs: imageTry.elapsedMs,
      meta: imageTry.raw,
      image_error: null as string | null,
    };
  }

  console.warn("[khatmitthi-promo] image send failed, falling back to text", imageTry.error, imageTry.raw);

  // Fallback text still includes the image URL so the creative is reachable.
  const textBody = `${opts.caption}\n\n${imageUrl}`.slice(0, 4000);
  const via = await sendViaActiveWhatsAppProvider({
    phoneNumber: phone,
    text: textBody,
  });
  if (via.success) {
    return {
      success: true,
      code: via.code,
      provider: via.provider,
      providerMessageId: via.providerMessageId || via.metaMessageId,
      error: undefined as string | undefined,
      used_image: false,
      elapsedMs: via.elapsedMs,
      meta: via.meta,
      image_error: imageTry.error || imageTry.code,
    };
  }

  const textTry = await evolutionGoSendText({ number: phone, text: textBody });
  return {
    success: textTry.success,
    code: textTry.code,
    provider: "evolution_go" as const,
    providerMessageId: textTry.providerMessageId,
    error: textTry.error,
    used_image: false,
    elapsedMs: textTry.elapsedMs,
    meta: textTry.raw,
    image_error: imageTry.error || imageTry.code,
  };
}

async function generateText(prompt: string): Promise<string | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("[khatmitthi-promo] text gen failed", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? stripFancyDashes(content.trim()) : null;
}

async function generatePromoImage(prompt: string): Promise<{ bytes: Uint8Array; format: string } | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    console.error("[khatmitthi-promo] image gen failed", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const imageData = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof imageData !== "string") return null;
  const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) return null;
  const format = match[1] === "jpg" ? "jpeg" : match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, format };
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = makeJson(corsHeaders);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  const authHeader = req.headers.get("Authorization") || "";
  const isService = isServiceRoleRequest(req, serviceKey);
  const isCron = isCronSecretRequest(req);

  const admin = createClient(supabaseUrl, serviceKey);
  let isAdmin = false;
  if (!isService && !isCron && authHeader.startsWith("Bearer ") && anonKey) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin");
      isAdmin = !!roles && roles.length > 0;
    }
  }

  if (!isService && !isCron && !isAdmin) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as {
    dry_run?: boolean;
    force?: boolean;
    trigger?: string;
  };
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const now = new Date();
  let runId: string | null = null;

  try {
    const { data: cfgRow } = await admin
      .from("notification_config")
      .select("value")
      .eq("key", "khatmitthi_whatsapp_promo")
      .maybeSingle();
    const config = mergeKhatmitthiPromoConfig(cfgRow?.value);

    if (config.mode === "off" && !dryRun) {
      return json({ ok: true, skipped: true, reason: "mode_off" });
    }
    if (!force && !dryRun && inQuietHours(config, now)) {
      return json({ ok: true, skipped: true, reason: "quiet_hours", ist: istParts(now) });
    }
    if (!force && !dryRun) {
      const since = new Date(now.getTime() - config.interval_minutes * 60_000).toISOString();
      const { data: recentOk } = await admin
        .from("khatmitthi_promo_runs")
        .select("id, started_at, status")
        .gte("started_at", since)
        .in("status", ["sent", "shadow", "partial", "running"])
        .order("started_at", { ascending: false })
        .limit(1);
      if (recentOk && recentOk.length > 0) {
        return json({
          ok: true,
          skipped: true,
          reason: "interval_not_elapsed",
          interval_minutes: config.interval_minutes,
          last: recentOk[0],
        });
      }
    }

    const { data: runRow, error: runErr } = await admin
      .from("khatmitthi_promo_runs")
      .insert({
        status: "running",
        mode: config.mode,
        dry_run: dryRun,
        recipients: config.recipients,
        coupon_code: config.coupon_code,
        meta: { trigger: body.trigger || (isCron ? "cron" : "manual"), force, provider: config.provider },
      })
      .select("id")
      .single();
    if (runErr) throw runErr;
    runId = runRow.id as string;

    const { data: productRows, error: productErr } = await admin
      .from("products")
      .select("id, name, price, image_url, category, is_available, approval_status")
      .eq("seller_id", config.seller_id)
      .eq("approval_status", "approved")
      .eq("is_available", true);
    if (productErr) throw productErr;

    const products: PromoProduct[] = (productRows || []).map((p: any) => ({
      id: String(p.id),
      name: String(p.name || ""),
      price: p.price == null ? null : Number(p.price),
      imageUrl: p.image_url ? String(p.image_url) : null,
      category: p.category ? String(p.category) : null,
    })).filter((p) => p.name);

    const { data: history } = await admin
      .from("khatmitthi_promo_runs")
      .select("angle, product_id, caption, caption_hash, status")
      .in("status", ["sent", "shadow", "partial"])
      .order("started_at", { ascending: false })
      .limit(20);

    const recentAngles = (history || []).map((h: any) => String(h.angle || "")).filter(Boolean);
    const recentProductIds = (history || []).map((h: any) => String(h.product_id || "")).filter(Boolean);
    const recentCaptions = (history || []).map((h: any) => String(h.caption || "")).filter(Boolean);
    const recentHashes = new Set((history || []).map((h: any) => String(h.caption_hash || "")).filter(Boolean));

    const angle = pickAngle(recentAngles, now);
    const product = pickProduct(products, recentProductIds);
    if (!product) {
      await admin.from("khatmitthi_promo_runs").update({
        status: "skipped",
        skip_reason: "no_products",
        finished_at: new Date().toISOString(),
        angle,
      }).eq("id", runId);
      return json({ ok: true, skipped: true, reason: "no_products", run_id: runId });
    }

    let caption = await generateText(buildCopyPrompt({
      angle,
      productName: product.name,
      price: product.price,
      coupon: config.coupon_code,
      offerLabel: config.offer_label,
      androidUrl: config.android_url,
      iosUrl: config.ios_url,
      webUrl: config.web_url,
      recentCaptions,
      societyName: config.society_name,
    }));
    if (!caption) {
      caption = buildCaptionFallback({
        angle,
        productName: product.name,
        coupon: config.coupon_code,
        offerLabel: config.offer_label,
        androidUrl: config.android_url,
        iosUrl: config.ios_url,
        webUrl: config.web_url,
        societyName: config.society_name,
      });
    }
    caption = normalizeCaption(caption, config);

    let captionHash = hashString(caption.toLowerCase().replace(/\s+/g, " "));
    if (recentHashes.has(captionHash)) {
      caption = normalizeCaption(
        `${caption}\n\nFresh from Khatmitthi - ${product.name} waiting for you.`,
        config,
      );
      captionHash = hashString(caption.toLowerCase().replace(/\s+/g, " "));
    }

    const headline = extractHeadline(caption);
    const useRealPhoto = shouldUseRealProductPhoto(config, angle, product);
    let creativeImageUrl: string | null = null;
    let imageSource: "seller_product_photo" | "ai_promo_poster" | "none" = "none";

    if (useRealPhoto && product.imageUrl) {
      creativeImageUrl = product.imageUrl;
      imageSource = "seller_product_photo";
    } else {
      const generated = await generatePromoImage(buildImagePrompt({
        angle,
        productName: product.name,
        coupon: config.coupon_code,
        offerLabel: config.offer_label,
        headline,
        societyName: config.society_name,
      }));
      if (generated) {
        const ext = generated.format === "jpeg" ? "jpg" : generated.format;
        const path = `marketing/khatmitthi/${istParts(now).dateKey}/${runId}.${ext}`;
        const { error: upErr } = await admin.storage
          .from("app-images")
          .upload(path, generated.bytes, {
            contentType: `image/${generated.format}`,
            upsert: false,
          });
        if (!upErr) {
          const { data: urlData } = admin.storage.from("app-images").getPublicUrl(path);
          creativeImageUrl = urlData.publicUrl;
          imageSource = "ai_promo_poster";
        } else {
          console.error("[khatmitthi-promo] upload failed", upErr);
        }
      }
      if (!creativeImageUrl && product.imageUrl) {
        creativeImageUrl = product.imageUrl;
        imageSource = "seller_product_photo";
      }
    }

    if (!creativeImageUrl) {
      await admin.from("khatmitthi_promo_runs").update({
        status: "failed",
        error_message: "No creative image available",
        finished_at: new Date().toISOString(),
        angle,
        headline,
        caption,
        caption_hash: captionHash,
        product_id: product.id,
        product_name: product.name,
        product_image_url: product.imageUrl,
        image_source: imageSource,
      }).eq("id", runId);
      return json({ ok: false, error: "no_image", run_id: runId }, 500);
    }

    const imageHash = hashString(creativeImageUrl);
    const payloadPreview = {
      angle,
      headline,
      caption,
      coupon_code: config.coupon_code,
      product: { id: product.id, name: product.name, image_url: product.imageUrl },
      creative_image_url: creativeImageUrl,
      image_source: imageSource,
      recipients: config.recipients,
      note: imageSource === "ai_promo_poster"
        ? "AI promotional poster (marketing creative, not a seller product photograph)"
        : "Actual Khatmitthi product photograph from Sociva catalog",
    };

    if (dryRun || config.mode === "shadow") {
      await admin.from("khatmitthi_promo_runs").update({
        status: dryRun ? "dry_run" : "shadow",
        finished_at: new Date().toISOString(),
        angle,
        headline,
        caption,
        caption_hash: captionHash,
        product_id: product.id,
        product_name: product.name,
        product_image_url: product.imageUrl,
        creative_image_url: creativeImageUrl,
        image_source: imageSource,
        image_hash: imageHash,
        delivery_results: [],
        meta: {
          ...payloadPreview,
          mode: config.mode,
          dry_run: dryRun,
          wa_policy: "Uses the same Evolution Go pipe as seller order WhatsApp alerts.",
        },
      }).eq("id", runId);

      return json({
        ok: true,
        dry_run: dryRun,
        mode: config.mode,
        run_id: runId,
        preview: payloadPreview,
        sent: false,
      });
    }

    const deliveryResults: Array<Record<string, unknown>> = [];
    for (const rawPhone of config.recipients) {
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        deliveryResults.push({ phone: rawPhone, success: false, code: "invalid_phone" });
        continue;
      }

      const final = await deliverPromo({
        phone,
        caption,
        imageUrl: creativeImageUrl,
      });

      deliveryResults.push({
        phone,
        success: final.success,
        code: final.code,
        provider: final.provider,
        providerMessageId: final.providerMessageId || null,
        error: final.error || null,
        used_image: final.used_image,
        image_error: final.image_error || null,
        elapsedMs: final.elapsedMs,
      });
    }

    const okCount = deliveryResults.filter((d) => d.success).length;
    const status = okCount === 0 ? "failed" : okCount < deliveryResults.length ? "partial" : "sent";

    await admin.from("khatmitthi_promo_runs").update({
      status,
      finished_at: new Date().toISOString(),
      angle,
      headline,
      caption,
      caption_hash: captionHash,
      product_id: product.id,
      product_name: product.name,
      product_image_url: product.imageUrl,
      creative_image_url: creativeImageUrl,
      image_source: imageSource,
      image_hash: imageHash,
      delivery_results: deliveryResults,
      error_message: okCount === 0
        ? "All WhatsApp deliveries failed on Evolution Go / active provider."
        : null,
      meta: {
        provider: config.provider,
        wa_policy: "Same Evolution Go delivery path as seller order alerts.",
      },
    }).eq("id", runId);

    return json({
      ok: okCount > 0,
      mode: "live",
      run_id: runId,
      status,
      preview: payloadPreview,
      delivery_results: deliveryResults,
      sent: okCount > 0,
    });
  } catch (e) {
    console.error("[khatmitthi-promo] fatal", e);
    if (runId) {
      await admin.from("khatmitthi_promo_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: e instanceof Error ? e.message : String(e),
      }).eq("id", runId);
    }
    return json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      run_id: runId,
    }, 500);
  }
});
