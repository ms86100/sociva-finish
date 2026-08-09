const fs = require("fs");
const list = fs.readFileSync(
  "C:/Users/thech/.cursor/projects/c-Users-thech-OneDrive-Desktop-Sociva-finish-sociva-v1-main-sociva-v1-main/agent-tools/df724e76-a5b3-47ab-9132-8a254a37b71c.txt",
  "utf8",
);
const data = JSON.parse(list);
const names = data.migrations.map((m) => m.name);
const hits = names.filter(
  (n) =>
    n.includes("chat_booking") ||
    n.includes("production_hardening") ||
    n.includes("enqueue_user") ||
    n.includes("reschedule"),
);
console.log(JSON.stringify({ total: names.length, hits }, null, 2));
const args = JSON.parse(
  fs.readFileSync(".tmp-fn-deploy/_apply_mig_args.json", "utf8"),
);
console.log(
  JSON.stringify({
    name: args.name,
    queryLen: args.query.length,
    project_id: args.project_id,
  }),
);
