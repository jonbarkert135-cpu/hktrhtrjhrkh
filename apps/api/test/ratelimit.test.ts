import { describe, expect, it } from 'vitest';
import {
  FixedWindowLimiter,
  LOGIN_RULE,
  SIGNUP_RULE,
  loginKey,
  resolveSignupRule,
  signupKey,
} from '../src/auth/rate-limit.ts';

const limiterAt = (clock: { t: number }) => new FixedWindowLimiter(() => clock.t);

describe('auth rate limits', () => {
  it('allows 10 logins per 5 minutes per IP+email and then blocks with a Retry-After', () => {
    const clock = { t: 0 };
    const limiter = limiterAt(clock);
    const key = loginKey('1.2.3.4', 'A@Example.com');
    for (let i = 0; i < 10; i += 1) expect(limiter.hit(key, LOGIN_RULE).allowed).toBe(true);

    const blocked = limiter.hit(key, LOGIN_RULE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(300);
  });

  it('scopes login limits per IP and per email, case-insensitively', () => {
    const clock = { t: 0 };
    const limiter = limiterAt(clock);
    for (let i = 0; i < 10; i += 1) limiter.hit(loginKey('1.2.3.4', 'a@example.com'), LOGIN_RULE);

    expect(limiter.hit(loginKey('1.2.3.4', 'A@EXAMPLE.COM'), LOGIN_RULE).allowed).toBe(false);
    expect(limiter.hit(loginKey('5.6.7.8', 'a@example.com'), LOGIN_RULE).allowed).toBe(true);
    expect(limiter.hit(loginKey('1.2.3.4', 'b@example.com'), LOGIN_RULE).allowed).toBe(true);
  });

  it('reopens the window once it has elapsed', () => {
    const clock = { t: 0 };
    const limiter = limiterAt(clock);
    const key = signupKey('1.2.3.4');
    for (let i = 0; i < 5; i += 1) expect(limiter.hit(key, SIGNUP_RULE).allowed).toBe(true);
    expect(limiter.hit(key, SIGNUP_RULE).allowed).toBe(false);

    clock.t += SIGNUP_RULE.windowMs + 1;
    expect(limiter.hit(key, SIGNUP_RULE).allowed).toBe(true);
  });
});

describe('resolveSignupRule', () => {
  it('never lets the override weaken production', () => {
    expect(resolveSignupRule('production', '5000')).toEqual(SIGNUP_RULE);
  });

  it('raises the ceiling outside production so e2e can create one account per spec', () => {
    expect(resolveSignupRule('local', '500')).toEqual({
      limit: 500,
      windowMs: SIGNUP_RULE.windowMs,
    });
  });

  it('falls back to the production budget for a missing or nonsense value', () => {
    expect(resolveSignupRule('local', undefined)).toEqual(SIGNUP_RULE);
    expect(resolveSignupRule('local', 'lots')).toEqual(SIGNUP_RULE);
    expect(resolveSignupRule('local', '0')).toEqual(SIGNUP_RULE);
    expect(resolveSignupRule('preview', '2.5')).toEqual(SIGNUP_RULE);
  });
});
