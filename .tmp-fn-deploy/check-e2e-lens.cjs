const fs = require('fs');
for (let i = 0; i <= 6; i++) {
  const c = fs.readFileSync(`.tmp-fn-deploy/_e2e_ins_${i}.sql`, 'utf8');
  const m = c.match(new RegExp(`VALUES \\(${i}, '([^']+)'`));
  console.log(i, m ? m[1].length : 'NO');
}
const all = fs.readFileSync('.tmp-fn-deploy/_e2e_all.sql', 'utf8');
console.log('all sql exists', all.length);
