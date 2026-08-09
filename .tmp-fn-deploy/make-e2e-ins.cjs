const fs = require('fs');
const j = JSON.parse(fs.readFileSync('.tmp-fn-deploy/apply-wallet_mvp_e2e_gaps.json', 'utf8'));
const q = j.query;
const b64 = Buffer.from(q, 'utf8').toString('base64');
const chunkSize = 5500;
const parts = [];
for (let i = 0; i < b64.length; i += chunkSize) {
  parts.push(b64.slice(i, i + chunkSize));
}
parts.forEach((p, i) => {
  const sql = `INSERT INTO public._tmp_mig_chunks(id, chunk) VALUES (${i}, '${p}') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;`;
  fs.writeFileSync(`.tmp-fn-deploy/_e2e_ins_${i}.sql`, sql);
});
fs.writeFileSync('.tmp-fn-deploy/_e2e_meta.json', JSON.stringify({ parts: parts.length, qLen: q.length, b64Len: b64.length }));
console.log(JSON.stringify({ parts: parts.length, qLen: q.length }));
