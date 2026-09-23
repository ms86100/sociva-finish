/**
 * WhatsApp / social crawlers need path-based HTML with Open Graph tags.
 * Hash routes (#/product/…) are invisible to crawlers, so shares use this endpoint.
 * Humans (and in-app App Links) are redirected into the SPA: /#/product/:id
 */

export const config = { runtime: 'edge' };

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://kkzkuyhgdvyecmxtmkpy.supabase.co';

/** Same publishable key as src/integrations/supabase/client.ts */
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

/** Prefer a larger absolute image for WhatsApp / iMessage link previews. */
function toOgImage(raw: string | null | undefined, origin: string): string {
  const src = String(raw || '').trim();
  if (!src) return DEFAULT_OG_IMAGE;
  let absolute = src;
  if (src.startsWith('//')) absolute = `https:${src}`;
  else if (src.startsWith('/')) absolute = `${origin}${src}`;
  try {
    const u = new URL(absolute);
    if (u.hostname.includes('images.unsplash.com')) {
      u.searchParams.set('auto', 'format');
      u.searchParams.set('fit', 'crop');
      u.searchParams.set('w', '1200');
      u.searchParams.set('h', '630');
      u.searchParams.set('q', '80');
      return u.toString();
    }
    return absolute;
  } catch {
    return DEFAULT_OG_IMAGE;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const productId = decodeURIComponent(parts[parts.length - 1] || '');
  const origin = appOrigin(req);
  const deepLink = `${origin}/#/product/${encodeURIComponent(productId)}`;

  let title = 'Sociva product';
  let description = 'Found on Sociva - your neighbourhood marketplace.';
  let image = DEFAULT_OG_IMAGE;

  if (productId && productId !== 'product') {
    try {
      const key = anonKey();
      const qs = new URLSearchParams({
        select: 'id,name,price,image_url,seller:seller_profiles!products_seller_id_fkey(business_name)',
        id: `eq.${productId}`,
        limit: '1',
      });
      const res = await fetch(`${SUPABASE_URL}/rest/v1/products?${qs.toString()}`, {
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
          const sellerName = row.seller?.business_name || 'a neighbour';
          const price = typeof row.price === 'number' || typeof row.price === 'string'
            ? `₹${Math.round(Number(row.price))}`
            : '';
          title = row.name || title;
          description = price
            ? `${row.name} - ${price} from ${sellerName} on Sociva`
            : `${row.name} from ${sellerName} on Sociva`;
          image = toOgImage(row.image_url, origin);
        }
      }
    } catch {
      // keep defaults
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | Sociva</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="product" />
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
  <meta http-equiv="refresh" content="0;url=${escapeHtml(deepLink)}" />
  <link rel="canonical" href="${escapeHtml(deepLink)}" />
</head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0f;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <p>Opening <strong>${escapeHtml(title)}</strong> on Sociva…</p>
  <script>location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short cache so WhatsApp refreshes product image/title after listing edits
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
