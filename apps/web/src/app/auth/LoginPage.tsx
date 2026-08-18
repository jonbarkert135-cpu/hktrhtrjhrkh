import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Banner, Button, Field } from '@nexus/ui';
import { authClient } from '../../lib/auth';

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.includes('@')) errors.email = 'Enter an email address, like you@example.com.';
    if (password.length === 0) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const result = await authClient.signIn.email({ email, password });
    setSubmitting(false);

    if (result.error) {
      setFormError(
        "That email and password don't match. Check them, or reset your password to sign in.",
      );
      return;
    }
    const next = params.get('next');
    void navigate(next && next.startsWith('/') ? next : '/', { replace: true });
  }

  return (
    <div className="nx-auth">
      <main className="nx-auth-card nx-stack">
        <h1>Sign in to Raven OSINT</h1>
        {formError ? (
          <Banner kind="danger" title="Couldn't sign you in">
            {formError}
          </Banner>
        ) : null}
        <form className="nx-stack" onSubmit={(event) => void onSubmit(event)} noValidate>
          <Field
            label="Email"
            {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            disabled={submitting}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label="Password"
            {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" loading={submitting} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="nx-muted">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </main>
    </div>
  );
}
