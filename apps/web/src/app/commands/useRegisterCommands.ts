/**
 * Registers a set of commands for as long as the calling component is mounted (P7 §5.8): a board
 * page registers "rename this board", a project page registers "rename this project", and so on.
 * This is what keeps the palette's command list identical to whatever menus are on screen —
 * they call the same mutation, from the same component, so they cannot drift apart.
 *
 * Re-registers on every render rather than trying to diff the list: the caller's commands close
 * over current component state (a board's current title, say), and Map set/delete is cheap enough
 * that re-running it every render costs nothing a user could notice.
 */

import { useEffect } from 'react';

import { commandRegistry, type Command } from './registry.ts';

export function useRegisterCommands(commands: readonly Command[]): void {
  useEffect(() => {
    for (const command of commands) commandRegistry.register(command);
    return () => {
      for (const command of commands) commandRegistry.unregister(command.id);
    };
  });
}
