import { useEffect, useState } from 'react';
import { supabase, type Session } from '../lib/supabase.js';
import { DiscoveryPanel, type DiscoveryPanelProps } from './DiscoveryPanel.js';
import { hostedRequest } from './discovery-client.js';

export function HostedDiscovery(props: DiscoveryPanelProps) {
  const [session, setSession] = useState<Session | null>(null), [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    const client = supabase();
    const { data } = client.auth.onAuthStateChange((_event, next) => { if (active) { setSession(next); setLoading(false); } });
    void client.auth.getSession().then(({ data, error }) => { if (active) { setSession(data.session); setLoading(false); if (error) setError(error.message); } }).catch(() => { if (active) { setLoading(false); setError('Sign-in is temporarily unavailable.'); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  async function authenticate() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = mode === 'signin' ? await supabase().auth.signInWithPassword({ email: email.trim(), password })
        : await supabase().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: new URL(".", window.location.href).href } });
      if (result.error) throw result.error;
      setPassword('');
      if (mode === 'signup' && !result.data.session) setNotice('Check your email to confirm your account, then sign in here.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (session) return <div className="hosted-discovery">
    <div className="discovery-controls"><span className="hint">Signed in as {session.user.email}</span><button disabled={busy} onClick={() => {
      setBusy(true); setError(''); void supabase().auth.signOut({ scope: 'local' }).then(({ error }) => { if (error) setError(error.message); }).catch(() => setError('Could not sign out. Try again.')).finally(() => setBusy(false));
    }}>Sign out</button></div>
    {error && <p role="alert" className="jobs-error">{error}</p>}
    <DiscoveryPanel key={session.user.id} {...props} request={hostedRequest} hosted />
  </div>;
  return <aside className="card discovery-panel" aria-label="Search more job sites">
    <p className="eyebrow">BROADER JOB DISCOVERY · BETA</p><h2>Search more job sites</h2>
    <p>Sign in for additional listings from JSearch, including LinkedIn listings when available. Your selected roles and countries still apply.</p>
    <p className="hint">The main job feed works without an account. Your candidate profile, résumés and application tracker stay in this browser. Search preferences are sent to our search service; your account email is used for sign-in.</p>
    {loading ? <p role="status">Checking sign-in…</p> : <form className="discovery-controls" onSubmit={e => { e.preventDefault(); void authenticate(); }}>
      <label className="field">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="field">Password<input required type="password" minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      <button type="button" disabled={busy} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); }}>{mode === 'signin' ? 'Create an account' : 'Use an existing account'}</button>
    </form>}
    {notice && <p role="status">{notice}</p>}{error && <p className="jobs-error" role="alert">{error}</p>}
  </aside>;
}
