// One-shot: delete storage objects for a user folder. POST { userId, buckets }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const files: Record<string,string[]> = {
    'payment-proofs': [
      'b3220352-30c5-4d23-98b1-f0911074f444/9eedf92a-990c-4b6c-8d1b-b79d94ec7caf.jpeg',
      'b3220352-30c5-4d23-98b1-f0911074f444/e9d677da-bb13-47c3-b9c0-e860923a25b7.png',
    ],
    'app-images': [
      'b3220352-30c5-4d23-98b1-f0911074f444/products/1776832386950.jpg',
      'b3220352-30c5-4d23-98b1-f0911074f444/products/ai-1776834552911.png',
      'b3220352-30c5-4d23-98b1-f0911074f444/products/1776835656899.jpg',
    ],
  };
  const out: any = {};
  for (const [b, names] of Object.entries(files)) {
    const { data, error } = await admin.storage.from(b).remove(names);
    out[b] = error ? `err:${error.message}` : data?.map(d => d.name);
  }
  return new Response(JSON.stringify(out), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
