import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { withAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const { allowed } = await checkRateLimit(`gen-cat-image:${userId}`, 10, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const { categoryName, parentGroup, categoryKey, targetType } = await req.json();

    if (!categoryName || !categoryKey) {
      return new Response(
        JSON.stringify({ error: "categoryName and categoryKey are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isSubcategory = targetType === 'subcategory';
    const bucketName = isSubcategory ? 'subcategory-images' : 'category-images';
    const targetTable = isSubcategory ? 'subcategories' : 'category_config';

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const contextStr = isSubcategory
      ? `a "${categoryName}" subcategory under the "${parentGroup || 'general'}" category`
      : `a "${categoryName}" category`;

    const prompt = `Generate a high-quality, vibrant product photography image for ${contextStr} in a grocery/services marketplace app. The image should be a clean, well-lit product shot or service illustration on a light/neutral background. Style: professional e-commerce photography, appetizing if food, clean and modern if service. Square format 1:1. No text or labels in the image.`;

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway returned ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const imageData = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageData) {
      throw new Error("No image returned from AI");
    }

    const base64Match = imageData.match(
      /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/
    );
    if (!base64Match) {
      throw new Error("Invalid image data format");
    }

    const imageFormat = base64Match[1] === "jpg" ? "jpeg" : base64Match[1];
    const base64Data = base64Match[2];

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const filePath = `${categoryKey}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`;

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, bytes, {
        contentType: `image/${imageFormat}`,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Update the appropriate table
    if (isSubcategory) {
      // For subcategories, categoryKey is like "sub_<id>" — extract id
      const subId = categoryKey.replace('sub_', '');
      const { error: updateError } = await supabase
        .from(targetTable)
        .update({ image_url: publicUrl })
        .eq('id', subId);
      if (updateError) {
        console.error("DB update error:", updateError);
      }
    } else {
      const { error: updateError } = await supabase
        .from(targetTable)
        .update({ image_url: publicUrl })
        .eq("category", categoryKey);
      if (updateError) {
        console.error("DB update error:", updateError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, image_url: publicUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-category-image error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
