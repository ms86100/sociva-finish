import fs from "fs";
import path from "path";

const root = path.resolve("supabase/functions");
const skip = new Set(["_shared"]);
const patched = [];
const skipped = [];

for (const name of fs.readdirSync(root)) {
  if (skip.has(name)) continue;
  const file = path.join(root, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  if (!src.includes("Access-Control-Allow-Origin") || !src.includes('"*"')) {
    continue;
  }
  if (src.includes("corsHeadersFor")) {
    skipped.push(`${name} (already)`);
    continue;
  }

  const corsBlock =
    /const corsHeaders\s*=\s*\{[\s\S]*?Access-Control-Allow-Origin["']?\s*:\s*["']\*["'][\s\S]*?\};/;
  if (!corsBlock.test(src)) {
    skipped.push(`${name} (no simple block)`);
    continue;
  }

  src = src.replace(corsBlock, "/* cors: use corsHeadersFor(req) */");

  if (!src.includes("../_shared/cors.ts")) {
    if (/^import .+;$/m.test(src)) {
      src = src.replace(
        /^import .+;$/m,
        (m) =>
          `${m}\nimport { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";`,
      );
    } else {
      src =
        `import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";\n` +
        src;
    }
  }

  if (src.includes("Deno.serve(async (req)")) {
    src = src.replace(
      /Deno\.serve\(async \(req\)\s*=>\s*\{/,
      `Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }`,
    );
  } else if (/serve\(async \(req\)/.test(src)) {
    src = src.replace(
      /serve\(async \(req\)\s*=>\s*\{/,
      `serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }`,
    );
  } else {
    skipped.push(`${name} (no serve pattern)`);
    continue;
  }

  // Drop redundant early OPTIONS blocks that still reference old pattern
  src = src.replace(
    /\n\s*if\s*\(\s*req\.method\s*===\s*["']OPTIONS["']\s*\)\s*\{\s*return new Response\(null,\s*\{\s*headers:\s*corsHeaders\s*\}\);\s*\}\n/,
    "\n",
  );

  fs.writeFileSync(file, src);
  patched.push(name);
}

console.log("patched", patched.length);
console.log(patched.join("\n"));
console.log("skipped", skipped.length);
console.log(skipped.join("\n"));
