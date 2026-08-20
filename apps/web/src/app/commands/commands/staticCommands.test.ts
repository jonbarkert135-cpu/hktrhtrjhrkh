/**
 * The app-wide static commands (P7 §5.8): navigation to settings and the keyboard-shortcuts
 * help, registered once regardless of the open page.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { commandRegistry, type CommandContext } from '../registry.ts';
import { registerStaticCommands } from './staticCommands.ts';

const ctx: CommandContext = {
  role: 'admin',
  view: 'shell',
  projectId: null,
  boardId: null,
  navigate: vi.fn(),
};

describe('registerStaticCommands', () => {
  beforeAll(() => {
    // registerStaticCommands is idempotent (module-scoped flag) — call it once for the suite,
    // exactly like `main.tsx` does, and the calling-it-twice test below re-asserts that directly.
    registerStaticCommands();
  });

  it('registers nav.settings, which navigates to /settings', () => {
    const navigate = vi.fn();
    void commandRegistry.get('nav.settings')?.run({ ...ctx, navigate });
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('registers help.shortcuts, which alerts the shortcut list', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    void commandRegistry.get('help.shortcuts')?.run(ctx);
    expect(alertSpy).toHaveBeenCalledOnce();
    expect(alertSpy.mock.calls[0]?.[0]).toContain('command palette');
    alertSpy.mockRestore();
  });

  it('is idempotent: calling it again does not register duplicate commands', () => {
    const before = commandRegistry.available(ctx).filter((c) => c.id === 'nav.settings');
    registerStaticCommands();
    const after = commandRegistry.available(ctx).filter((c) => c.id === 'nav.settings');
    expect(after).toHaveLength(before.length);
    expect(after).toHaveLength(1);
  });
});
