/**
 * Baseline cross-society / RLS checks against staging (no Playwright webServer).
 */
const URL = "https://wwuanzbusxoyzixuprxs.supabase.co";
const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3dWFuemJ1c3hveXppeHVwcnhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTY2OTAsImV4cCI6MjEwNDg5MjY5MH0.TVZ3pwFUGpnnp4C4xhLgYZXljvAsM5V0GJziuz4hFqc";

async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      Prefer: "count=exact",
    },
  });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 120) };
}

const checks = [];
for (const table of [
  "_variant_gate_backup",
  "_variant_gate_scripts",
  "orders",
  "chat_messages",
  "device_tokens",
]) {
  const res = await rest(`${table}?select=*&limit=1`);
  // Expect empty or error for anon on sensitive tables
  const blocked =
    res.status === 401 ||
    res.status === 403 ||
    res.status === 200 && (res.body === "[]" || res.body.startsWith("[]"));
  checks.push({ table, ...res, pass: blocked });
  console.log(
    `${blocked ? "PASS" : "FAIL"} anon ${table} HTTP=${res.status} BODY=${res.body}`,
  );
}

const failed = checks.filter((c) => !c.pass).length;
process.exit(failed ? 1 : 0);
