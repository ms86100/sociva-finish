const fs = require('fs');
const c = fs.readFileSync('.tmp-fn-deploy/_e2e_ins_5.sql', 'utf8').trim();
const m = c.match(/VALUES \(5, '([^']+)'/);
const b = m[1];
const sql = Buffer.from(b, 'base64').toString('utf8');
console.log('len', b.length, 'ok decode', sql.length);
fs.writeFileSync('.tmp-fn-deploy/_e2e_fix5.sql', `UPDATE public._tmp_mig_chunks SET chunk = '${b}' WHERE id = 5;`);
