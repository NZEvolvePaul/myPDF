import { useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { Shell } from '../components/Shell';

/** Shows the sign-in form until there is a session, then the children. */
export function RequireLogin({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (!supabase) return <NotConfigured />;
  if (loading) return <Shell>Loading…</Shell>;
  if (!session) return <Login />;
  return <>{children}</>;
}

function NotConfigured() {
  return (
    <Shell>
      <h1>Sending isn't set up yet</h1>
      <p>
        Sending documents to other people needs the MyPDF server (Supabase). Signing documents yourself works without it.
      </p>
      <a className="button primary" href="#/">Sign a document myself</a>
    </Shell>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}${location.pathname}` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStage('code');
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError('That code did not work. Check it, or send a new one.');
  };

  return (
    <Shell>
      <div className="card narrow">
        <h1>Sign in to send documents</h1>
        {stage === 'email' ? (
          <form onSubmit={sendCode} className="form">
            <label>
              Email
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
            <p className="muted">No password needed. New here? This creates your account.</p>
          </form>
        ) : (
          <form onSubmit={verify} className="form">
            <p>
              We emailed a code to <strong>{email}</strong>. Enter it below, or tap the link in the email.
            </p>
            <label>
              Code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="link" onClick={() => setStage('email')}>
              Use a different email
            </button>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Shell>
  );
}
