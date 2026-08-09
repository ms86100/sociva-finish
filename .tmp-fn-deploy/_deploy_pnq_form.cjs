const fs = require("fs");

const token = fs.readFileSync(".tmp-fn-deploy/_sb_token.tmp", "utf8").trim();
const payload = JSON.parse(
  fs.readFileSync(".tmp-fn-deploy/_redeploy_from_v70.json", "utf8"),
);

const form = new FormData();
form.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        name: payload.name,
        entrypoint_path: payload.entrypoint_path,
        verify_jwt: true,
      }),
    ],
    { type: "application/json" },
  ),
);
for (const f of payload.files) {
  form.append(
    "file",
    new Blob([f.content], { type: "application/typescript" }),
    f.name,
  );
}

(async () => {
  const url =
    "https://api.supabase.com/v1/projects/" +
    payload.project_id +
    "/functions/deploy?slug=" +
    encodeURIComponent(payload.name);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  console.log(
    JSON.stringify({
      ok: res.ok,
      status: res.status,
      version: body.version,
      verify_jwt: body.verify_jwt,
      slug: body.slug,
      status_field: body.status,
      error: body.message || body.error || null,
    }),
  );
  process.exit(res.ok ? 0 : 1);
})();
