// One-shot: delete storage objects for a user folder. POST { userId, buckets }
// Audit P0: require service_role or admin — never unauthenticated.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';
  const isService = authHeader === `Bearer ${serviceKey}`;

  if (!isService) {
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: role } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const files: Record<string, string[]> = {
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
  const out: Record<string, unknown> = {};
  for (const [b, names] of Object.entries(files)) {
    const { data, error } = await admin.storage.from(b).remove(names);
    out[b] = error ? `err:${error.message}` : data?.map((d) => d.name);
  }
  return new Response(JSON.stringify(out), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
