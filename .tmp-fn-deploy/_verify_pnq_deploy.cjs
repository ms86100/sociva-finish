const fs = require("fs");
const j = JSON.parse(
  fs.readFileSync(
    "C:/Users/thech/.cursor/projects/c-Users-thech-OneDrive-Desktop-Sociva-finish-sociva-v1-main-sociva-v1-main/agent-tools/15c17400-20d6-4ee7-aac4-22d55b429cfd.txt",
    "utf8",
  ),
);
const idx = (j.files || []).find(
  (f) => f.name.endsWith("index.ts") || f.name === "index.ts",
);
const c = idx ? idx.content : "";
console.log(
  JSON.stringify(
    {
      id: j.id,
      slug: j.slug,
      version: j.version,
      status: j.status,
      verify_jwt: j.verify_jwt,
      entrypoint_path: j.entrypoint_path,
      files: (j.files || []).map((f) => f.name),
      chat_message: c.includes("chat_message"),
      message_pref: c.includes('notifType === "message"'),
      updated_at: j.updated_at,
    },
    null,
    2,
  ),
);
