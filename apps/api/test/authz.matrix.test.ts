import { describe, expect, it, vi } from 'vitest';

vi.mock('@nexus/db', () => ({ prisma: {}, recordAudit: vi.fn() }));

const { appRouter } = await import('../src/trpc/router.js');
const { ORG_ROLES } = await import('../src/trpc/context.js');

const ALLOWED = new Set<string>(['public', 'protected', ...ORG_ROLES]);

/**
 * Meta test: every procedure in the router — now and in every future phase — must declare how
 * it is authorized via `meta.auth`. Adding a procedure without a decision fails the build.
 */
describe('authz matrix', () => {
  const procedures = Object.entries(
    appRouter._def.procedures as unknown as Record<string, { _def: { meta?: { auth?: string } } }>,
  );

  it('has procedures to check', () => {
    expect(procedures.length).toBeGreaterThan(0);
  });

  it.each(procedures)('%s declares a known auth level', (_path, procedure) => {
    const auth = procedure._def.meta?.auth;
    expect(auth, 'missing meta({ auth }) on this procedure').toBeDefined();
    expect(ALLOWED.has(auth as string)).toBe(true);
  });

  it('keeps the public surface explicit and minimal', () => {
    const publics = procedures
      .filter(([, p]) => p._def.meta?.auth === 'public')
      .map(([path]) => path)
      .sort();
    expect(publics).toEqual(['auth.session']);
  });
});
