import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js';

export type DiscoveryRequest = <T>(body: unknown) => Promise<T>;
export const hostedRequest: DiscoveryRequest = async <T>(body: unknown): Promise<T> => {
  const { data, error } = await supabase().auth.getSession();
  if (error || !data.session) throw new Error('Sign in to search more job sites.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/job-discovery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign out and sign in again.' : value.error || 'Additional job search is unavailable.');
  return value as T;
};
