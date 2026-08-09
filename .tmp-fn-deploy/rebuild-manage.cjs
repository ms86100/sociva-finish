const fs = require("fs");
const root = "supabase/functions";
const read = (p) => fs.readFileSync(p, "utf8");
const idx = read(`${root}/manage-delivery/index.ts`);
const files = [
  { name: "index.ts", content: idx },
  { name: "../_shared/rate-limiter.ts", content: read(`${root}/_shared/rate-limiter.ts`) },
  { name: "../_shared/auth.ts", content: read(`${root}/_shared/auth.ts`) },
];
const payload = {
  project_id: "kkzkuyhgdvyecmxtmkpy",
  name: "manage-delivery",
  entrypoint_path: "index.ts",
  verify_jwt: false,
  files,
};
fs.writeFileSync(".tmp-fn-deploy/deploy-manage.json", JSON.stringify(payload));
console.log("size", JSON.stringify(payload).length);
console.log(files.map((f) => ({ n: f.name, l: f.content.length })));
console.log("has provider_changed", idx.includes("provider_changed"));
