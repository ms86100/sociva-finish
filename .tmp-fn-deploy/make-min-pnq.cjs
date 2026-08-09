const fs = require("fs");
const neu = JSON.parse(fs.readFileSync(".tmp-fn-deploy/deploy-pnq.json", "utf8"));
const by = Object.fromEntries(neu.files.map((f) => [f.name, f.content]));

function minifyTs(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

const files = [
  { name: "index.ts", content: by["index.ts"] },
  { name: "../_shared/credentials.ts", content: by["../_shared/credentials.ts"] },
  { name: "../_shared/whatsapp.ts", content: minifyTs(by["../_shared/whatsapp.ts"]) },
  { name: "../_shared/whatsapp-notify.ts", content: minifyTs(by["../_shared/whatsapp-notify.ts"]) },
];

const payload = {
  project_id: "kkzkuyhgdvyecmxtmkpy",
  name: "process-notification-queue",
  entrypoint_path: "index.ts",
  verify_jwt: false,
  files,
};

fs.writeFileSync(".tmp-fn-deploy/deploy-pnq-min.json", JSON.stringify(payload));
console.log("size", JSON.stringify(payload).length);
console.log(files.map((f) => ({ name: f.name, len: f.content.length })));
console.log("still has promotionsPref", files[0].content.includes("promotionsPref"));
console.log("notify has normalize", files[3].content.includes("normalizeWaPayload"));
