/**
 * Auto Arrange UI state. Ephemeral by design: which algorithm is selected, how far the run got and
 * what it proposes are *this user's* thinking, not the document — they never enter the CRDT
 * (`00_MASTER.md` N2, "Zustand for ephemeral UI state only"). Closing the tab loses the preview,
 * which is correct: nothing was accepted.
 */

import type { LayoutAlgorithmId, LayoutDiff, LayoutDirection } from '@nexus/layout';
import { create } from 'zustand';

export type AutoArrangeStatus = 'idle' | 'running' | 'preview' | 'empty' | 'error';

export type AutoArrangeScope = 'board' | 'selection';

export interface AutoArrangeOptions {
  readonly direction: LayoutDirection;
  readonly spacingX: number;
  readonly spacingY: number;
  readonly iterations: number;
  readonly seed: number;
}

export interface AutoArrangeState {
  open: boolean;
  algorithm: LayoutAlgorithmId;
  scope: AutoArrangeScope;
  options: AutoArrangeOptions;
  status: AutoArrangeStatus;
  /** 0..1, from the worker; drives the progress bar and the "cancel" affordance. */
  progress: number;
  diff: LayoutDiff | null;
  error: string | null;
  setOpen: (open: boolean) => void;
  setAlgorithm: (algorithm: LayoutAlgorithmId) => void;
  setScope: (scope: AutoArrangeScope) => void;
  setOption: <K extends keyof AutoArrangeOptions>(key: K, value: AutoArrangeOptions[K]) => void;
  started: () => void;
  progressed: (fraction: number) => void;
  previewed: (diff: LayoutDiff) => void;
  failed: (message: string) => void;
  /** Back to idle, dropping the preview: cancel, accept and close all end here. */
  reset: () => void;
}

export const DEFAULT_OPTIONS: AutoArrangeOptions = {
  direction: 'down',
  spacingX: 48,
  spacingY: 96,
  iterations: 120,
  seed: 1,
};

export const useAutoArrangeStore = create<AutoArrangeState>((set) => ({
  open: false,
  algorithm: 'hierarchical',
  scope: 'board',
  options: DEFAULT_OPTIONS,
  status: 'idle',
  progress: 0,
  diff: null,
  error: null,
  setOpen: (open) =>
    set(open ? { open } : { open, status: 'idle', diff: null, error: null, progress: 0 }),
  // Changing any input invalidates the preview: a preview that does not match the picker is a lie.
  setAlgorithm: (algorithm) => set({ algorithm, diff: null, status: 'idle', error: null }),
  setScope: (scope) => set({ scope, diff: null, status: 'idle', error: null }),
  setOption: (key, value) =>
    set((state) => ({
      options: { ...state.options, [key]: value },
      diff: null,
      status: 'idle',
      error: null,
    })),
  started: () => set({ status: 'running', progress: 0, diff: null, error: null }),
  progressed: (fraction) => set({ progress: fraction }),
  previewed: (diff) =>
    set({
      diff,
      progress: 1,
      error: null,
      status: diff.moves.length === 0 ? 'empty' : 'preview',
    }),
  failed: (message) => set({ status: 'error', error: message, diff: null }),
  reset: () => set({ status: 'idle', progress: 0, diff: null, error: null }),
}));
