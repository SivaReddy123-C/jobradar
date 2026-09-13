import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { hostedDiscoveryHandler } from './core.js';

const url = Deno.env.get('SUPABASE_URL')!;
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error('Discovery storage is unavailable.');
  return data;
}
Deno.serve(hostedDiscoveryHandler({
  getKey: () => Deno.env.get('OPENWEBNINJA_API_KEY') || '',
  authenticate: async (token: string) => {
    const { data, error } = await admin.auth.getUser(token);
    return !error && data.user?.email_confirmed_at && !data.user.is_anonymous ? data.user.id : null;
  },
  store: {
    access: (user: string) => rpc('jr_discovery_access', { p_user: user }),
    status: (user: string) => rpc('jr_discovery_status', { p_user: user }),
    restore: (keys: string[]) => rpc('jr_discovery_restore', { p_keys: keys }),
    reserve: (key: string, user: string) => rpc('jr_discovery_reserve', { p_key: key, p_user: user }),
    finish: (key: string, id: string, rows: unknown[], more: boolean, failed: boolean) => rpc('jr_discovery_finish', { p_key: key, p_id: id, p_rows: rows, p_more: more, p_failed: failed }),
  },
}));
