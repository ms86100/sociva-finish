const fs = require('fs');
for (let i = 0; i < 4; i++) {
  const c = fs.readFileSync(`.tmp-fn-deploy/_cmvo_b64_${i}.txt`, 'utf8');
  const sql = `INSERT INTO public._tmp_mig_chunks(id, chunk) VALUES (${i}, '${c}') ON CONFLICT (id) DO UPDATE SET chunk = EXCLUDED.chunk;`;
  fs.writeFileSync(`.tmp-fn-deploy/_ins_${i}.sql`, sql);
  console.log(i, c.length, sql.length);
}
const execSql = `DO $outer$
DECLARE
  sql text;
BEGIN
  SELECT convert_from(decode(string_agg(chunk, '' ORDER BY id), 'base64'), 'utf8')
    INTO sql
  FROM public._tmp_mig_chunks;
  EXECUTE sql;
END;
$outer$;
DROP TABLE IF EXISTS public._tmp_mig_chunks;`;
fs.writeFileSync('.tmp-fn-deploy/_cmvo_exec.sql', execSql);
console.log('exec', execSql.length);
