import fs from "fs";
import path from "path";

const root = path.resolve("supabase/functions");
const patched = [];
const skipped = [];

const corsBlock =
  /const corsHeaders\s*=\s*\{[\s\S]*?Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"][\s\S]*?\};/;

for (const name of fs.readdirSync(root)) {
  if (name === "_shared") continue;
  const file = path.join(root, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  if (!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(src)) continue;
  if (!corsBlock.test(src)) {
    skipped.push(`${name} (no simple block)`);
    continue;
  }
  if (!/Deno\.serve\(async \(req\)/.test(src)) {
    skipped.push(`${name} (no Deno.serve)`);
    continue;
  }

  // Prefer mutable module cors when helpers close over corsHeaders
  const usesMutable =
    src.includes("function jsonResponse") ||
    /function\s+\w+[\s\S]{0,200}corsHeaders/.test(src);

  src = src.replace(
    corsBlock,
    usesMutable
      ? "let corsHeaders: Record<string, string> = {};"
      : "/* cors: use corsHeadersFor(req) */",
  );

  if (!src.includes("../_shared/cors.ts")) {
    src = src.replace(
      /^import .+;$/m,
      (m) =>
        `${m}\nimport { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";`,
    );
  }

  const inject = usesMutable
    ? `Deno.serve(async (req) => {
  corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS" || req.method === 'OPTIONS') {
    return handleCorsPreflight(req);
  }`
    : `Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS" || req.method === 'OPTIONS') {
    return handleCorsPreflight(req);
  }`;

  src = src.replace(/Deno\.serve\(async \(req\)\s*=>\s*\{/, inject);

  src = src.replace(
    /\n\s*if\s*\(\s*req\.method\s*===\s*['"]OPTIONS['"]\s*\)\s*\{\s*return new Response\(null,\s*\{\s*headers:\s*corsHeaders\s*\}\);\s*\}\n/g,
    "\n",
  );

  fs.writeFileSync(file, src);
  patched.push(`${name}${usesMutable ? " (mutable)" : ""}`);
}

console.log("patched", patched.length);
console.log(patched.join("\n"));
console.log("skipped", skipped.length);
console.log(skipped.join("\n") || "(none)");
