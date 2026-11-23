import fs from "fs";
import { spawnSync } from "child_process";

const env = { ...process.env };
for (const line of fs.readFileSync(".env.staging", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
env.SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
env.SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;

const r = spawnSync(process.execPath, ["scripts/staging-soak-gap-close.mjs"], {
  env,
  encoding: "utf8",
});
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status || 0);
