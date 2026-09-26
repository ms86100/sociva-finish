/**
 * Store share OG landing - same pattern as product share.
 * Humans redirect to /#/seller/:id
 */

import { buildShareOpenScript } from '../../../src/lib/share-android-handoff';

export const config = { runtime: 'edge' };

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://kkzkuyhgdvyecmxtmkpy.supabase.co';

const LIVE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA';

const DEFAULT_OG_IMAGE =
  'https://storage.googleapis.com/gpt-engineer-file-uploads/BIGOZ5GNb4QR5gjdzagHKwPFZlp2/social-images/social-1775487812450-steamy-chicken-momos-with-black-background-and-ser-upscaled.webp';

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appOrigin(req: Request): string {
  const url = new URL(req.url);
  if (url.hostname.includes('localhost') || url.hostname.includes('127.0.0.1')) {
    return 'https://www.sociva.in';
  }
  return `${url.protocol}//${url.host}`;
}

function anonKey(): string {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || LIVE_ANON_KEY;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const sellerId = decodeURIComponent(parts[parts.length - 1] || '');
  const origin = appOrigin(req);
  const deepLink = `${origin}/#/seller/${encodeURIComponent(sellerId)}`;

  let title = 'Sociva store';
  let description = 'Shop neighbourhood products on Sociva.';
  let image = DEFAULT_OG_IMAGE;

  if (sellerId && sellerId !== 'store') {
    try {
      const key = anonKey();
      const qs = new URLSearchParams({
                    select: 'id,business_name,cover_image_url,description',
        id: `eq.${sellerId}`,
        limit: '1',
      });
      const res = await fetch(`${SUPABASE_URL}/rest/v1/seller_profiles?${qs.toString()}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row) {
          title = row.business_name || title;
          description = row.description
            ? String(row.description).slice(0, 160)
            : `Check out ${title} on Sociva - your neighbourhood marketplace.`;
          image = row.cover_image_url || image;
        }
      }
    } catch {
      // defaults
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | Sociva</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Sociva" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(url.toString())}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <link rel="canonical" href="${escapeHtml(deepLink)}" />
</head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0f;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center">
  <p>Opening <strong>${escapeHtml(title)}</strong> on Sociva…</p>
  <div id="sociva-android-actions" style="display:none;flex-direction:column;gap:12px;margin-top:20px;width:min(320px,100%)">
    <a id="sociva-open-app" href="${escapeHtml(deepLink)}" style="display:block;background:#fff;color:#0a0a0f;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 16px">Open in the Sociva app</a>
    <a id="sociva-store" href="https://play.google.com/store/apps/details?id=app.sociva.community&amp;hl=en_IN" style="display:block;color:#fff;text-decoration:underline;font-size:14px">Get it on Google Play</a>
  </div>
  <script>${buildShareOpenScript(url.toString(), deepLink)}</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
