DO $outer$
DECLARE
  sql text;
BEGIN
  SELECT convert_from(decode(string_agg(chunk, '' ORDER BY id), 'base64'), 'utf8')
    INTO sql
  FROM public._tmp_mig_chunks;
  EXECUTE sql;
END;
$outer$;
DROP TABLE IF EXISTS public._tmp_mig_chunks;