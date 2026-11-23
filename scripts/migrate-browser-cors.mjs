/**
 * Migrate browser-facing Edge Functions from CORS * to _shared/cors.ts.
 * Cron/webhook-only workers are left unchanged (no browser Origin).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "supabase/functions";

const BROWSER_FACING = [
  "validate-society",
  "quick-reorder",
  "summarize-thread",
  "ai-auto-review",
  "voip-call",
  "send-whatsapp",
  "create-seller-credit-order",
  "confirm-seller-credit-payment",
  "start-sociva-voice-call",
  "get-sociva-voice-call",
  "get-google-maps-key",
  "validate-upi-vpa",
  "generate-product-image",
  "generate-category-image",
  "notify-help-request",
  "generate-order-suggestions",
  "send-campaign",
  "evolution-go-admin",
  "manage-cron-jobs",
  "send-food-discovery",
  "send-khatmitthi-promo",
  "cleaner-city-work-email-otp",
  "cleaner-city-fuel-order",
  "cleaner-city-confirm-fuel",
  "cleaner-city-settle-fuel",
  "cleaner-city-dispatch-alerts",
  "process-notification-queue",
  "notification-diagnostics",
];

const IMPORT =
  'import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";\n';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeAtomic(file, content) {
  const tmp = file + ".tmp-cors";
  for (let i = 0; i < 6; i++) {
    try {
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      sleep(300);
      if (i === 5) throw e;
    }
  }
}

let patched = 0;
for (const name of BROWSER_FACING) {
  const file = path.join(ROOT, name, "index.ts");
  if (!fs.existsSync(file)) {
    console.log("SKIP missing", name);
    continue;
  }
  let s = fs.readFileSync(file, "utf8");
  if (s.includes("corsHeadersFor")) {
    console.log("SKIP already", name);
    continue;
  }
  if (!s.includes("Access-Control-Allow-Origin")) {
    console.log("SKIP no cors", name);
    continue;
  }

  if (!s.includes("_shared/cors.ts")) {
    // insert after first import block line that is an import
    const lines = s.split("\n");
    let lastImport = -1;
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      if (lines[i].startsWith("import ")) lastImport = i;
    }
    if (lastImport >= 0) {
      lines.splice(lastImport + 1, 0, IMPORT.trimEnd());
      s = lines.join("\n");
    } else {
      s = IMPORT + s;
    }
  }

  // Remove classic const corsHeaders = { ... Allow-Origin * ... };
  s = s.replace(
    /const corsHeaders\s*=\s*\{[\s\S]*?Access-Control-Allow-Origin["']?\s*:\s*["']\*["'][\s\S]*?\};/m,
    "/* cors: use corsHeadersFor(req) */",
  );

  // OPTIONS handlers
  s = s.replace(
    /if\s*\(\s*req\.method\s*===\s*["']OPTIONS["']\s*\)\s*\{?\s*return new Response\(\s*(?:null|["']ok["'])\s*,\s*\{\s*headers:\s*corsHeaders\s*\}\s*\)\s*;?\s*\}?/m,
    'if (req.method === "OPTIONS") {\n    return handleCorsPreflight(req);\n  }',
  );
  s = s.replace(
    /if\s*\(\s*req\.method\s*===\s*["']OPTIONS["']\s*\)\s*return new Response\(\s*(?:null|["']ok["'])\s*,\s*\{\s*headers:\s*corsHeaders\s*\}\s*\)\s*;/m,
    'if (req.method === "OPTIONS") return handleCorsPreflight(req);',
  );

  // Inject const cors = corsHeadersFor(req) near top of serve handler if corsHeaders still referenced
  if (s.includes("corsHeaders") && !s.includes("corsHeadersFor(req)")) {
    s = s.replace(
      /(serve\(async\s*\(req\)\s*=>\s*\{|Deno\.serve\(async\s*\(req\)\s*=>\s*\{)/,
      "$1\n  const corsHeaders = corsHeadersFor(req);",
    );
  }

  writeAtomic(file, s);
  patched++;
  console.log("PATCHED", name);
}

console.log("patched", patched);
