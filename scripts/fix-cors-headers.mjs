import fs from "node:fs";
import path from "node:path";

const ROOT = "supabase/functions";
const dirs = fs.readdirSync(ROOT);

function writeAtomic(file, content) {
  const tmp = file + ".tmp-fix";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

let fixed = 0;
for (const name of dirs) {
  const file = path.join(ROOT, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  let s = fs.readFileSync(file, "utf8");
  if (!s.includes("corsHeadersFor")) continue;

  // Fix glued "}try {"
  s = s.replace(/\}\s*try\s*\{/g, "}\n\n  try {");
  s = s.replace(/return handleCorsPreflight\(req\);\s*\}\s*try/g, "return handleCorsPreflight(req);\n  }\n\n  try");

  // Ensure handler defines corsHeaders from request
  if (s.includes("corsHeaders") && !s.includes("const corsHeaders = corsHeadersFor(req)")) {
    if (/Deno\.serve\(async\s*\(req\)/.test(s)) {
      s = s.replace(
        /Deno\.serve\(async\s*\(req\)\s*=>\s*\{/,
        "Deno.serve(async (req) => {\n  const corsHeaders = corsHeadersFor(req);",
      );
    } else if (/serve\(async\s*\(req\)/.test(s)) {
      s = s.replace(
        /serve\(async\s*\(req\)\s*=>\s*\{/,
        "serve(async (req) => {\n  const corsHeaders = corsHeadersFor(req);",
      );
    }
  }

  // json helper that closes over corsHeaders must move inside handler or use function
  // Pattern: const json = (...) => new Response(..., { headers: { ...corsHeaders
  // If json is outside serve and uses corsHeaders, rewrite to accept headers param
  const jsonOutside =
    /const json\s*=\s*\([^)]*\)\s*=>\s*new Response\([\s\S]*?\.\.\.corsHeaders/.test(s) &&
    s.indexOf("const json") < s.search(/serve\(|Deno\.serve\(/);
  if (jsonOutside) {
    // Move: change to factory
    s = s.replace(
      /const json\s*=\s*\(([^)]*)\)\s*=>\s*new Response\(\s*JSON\.stringify\(([^)]+)\),\s*\{\s*status([^,]*),\s*headers:\s*\{\s*\.\.\.corsHeaders,\s*"Content-Type":\s*"application\/json"\s*\}\s*\}\s*\);/,
      `const makeJson = (corsHeaders: Record<string, string>) => ($1) =>
  new Response(JSON.stringify($2), {
    status$3,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });`,
    );
  }

  writeAtomic(file, s);
  fixed++;
  console.log("FIXED", name);
}
console.log("fixed", fixed);
