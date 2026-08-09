const fs = require("fs");
const primary = JSON.parse(
  fs.readFileSync(
    "C:/Users/thech/OneDrive/Desktop/Sociva-finish/sociva-v1-main/sociva-v1-main/.tmp-fn-deploy/_mcp_deploy_pnq_args.json",
    "utf8",
  ),
);
const idx = primary.files[0].content;
const out = {
  project_id: primary.project_id,
  name: primary.name,
  entrypoint_path: "functions/process-notification-queue/index.ts",
  verify_jwt: false,
  file_count: primary.files.length,
  names: primary.files.map((f) => f.name),
  chat_ok:
    idx.includes("chat_message") &&
    idx.includes('notifType === "message"'),
};
console.log(JSON.stringify(out, null, 2));
