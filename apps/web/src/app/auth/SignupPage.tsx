import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Button, Field } from '@nexus/ui';
import { authClient } from '../../lib/auth';

const MIN_PASSWORD_LENGTH = 12;

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.includes('@')) errors.email = 'Enter an email address, like you@example.com.';
    if (password.length < MIN_PASSWORD_LENGTH)
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const result = await authClient.signUp.email({ email, password, name: name || email });
    setSubmitting(false);

    // Enumeration-resistant: an existing address gets the same confirmation as a new one.
    if (result.error && result.error.status !== 422 && result.error.status !== 400) {
      setFormError("We couldn't reach the server. Check your connection and try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="nx-auth">
        <main className="nx-auth-card nx-stack">
          <h1>Check your email</h1>
          <p className="nx-muted">
            If that address can be used, we sent a link to finish setting up your account.
          </p>
          <p className="nx-muted">
            <Link to="/login">Back to sign in</Link>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="nx-auth">
      <main className="nx-auth-card nx-stack">
        <h1>Create your NEXUS account</h1>
        {formError ? (
          <Banner kind="danger" title="Couldn't create your account">
            {formError}
          </Banner>
        ) : null}
        <form className="nx-stack" onSubmit={(event) => void onSubmit(event)} noValidate>
          <Field
            label="Name"
            name="name"
            autoComplete="name"
            value={name}
            disabled={submitting}
            onChange={(e) => setName(e.target.value)}
          />
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
            description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={submitting}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" loading={submitting} disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="nx-muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
