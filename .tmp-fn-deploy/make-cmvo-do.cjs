const fs = require('fs');
const q = fs.readFileSync('.tmp-fn-deploy/_mig2_b1.sql', 'utf8');
const b64 = Buffer.from(q, 'utf8').toString('base64');
const chunkSize = 6000;
const parts = [];
for (let i = 0; i < b64.length; i += chunkSize) {
  parts.push(b64.slice(i, i + chunkSize));
}
parts.forEach((p, i) => fs.writeFileSync(`.tmp-fn-deploy/_cmvo_b64_${i}.txt`, p));

const decodeExpr = parts.map((p) => `    '${p}'`).join(' ||\n');
const sql = `DO $outer$
DECLARE
  sql text;
BEGIN
  sql := convert_from(decode(
${decodeExpr}
  , 'base64'), 'utf8');
  EXECUTE sql;
END;
$outer$;
`;
fs.writeFileSync('.tmp-fn-deploy/_cmvo_do.sql', sql);
console.log(JSON.stringify({ parts: parts.length, doLen: sql.length, qLen: q.length }));
