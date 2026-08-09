const fs = require('fs');
const c = fs.readFileSync('.tmp-fn-deploy/_e2e_ins_6.sql', 'utf8').trim();
const m = c.match(/VALUES \(6, '([^']+)'/);
if (!m) {
  console.error('no match');
  process.exit(1);
}
const b = m[1];
const sql = Buffer.from(b, 'base64').toString('utf8');
console.log('ok', sql.includes('else o.payment_type'));
console.log('len', b.length);
fs.writeFileSync('.tmp-fn-deploy/_e2e_chunk6_b64.txt', b);
const upsert = `UPDATE public._tmp_mig_chunks SET chunk = '${b}' WHERE id = 6;`;
fs.writeFileSync('.tmp-fn-deploy/_e2e_fix6.sql', upsert);
console.log('wrote fix sql', upsert.length);
