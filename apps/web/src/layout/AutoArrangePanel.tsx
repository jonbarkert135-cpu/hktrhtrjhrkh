/**
 * The Auto Arrange surface (P14a): pick an algorithm, preview what it would do, accept or discard.
 *
 * Four rules it exists to enforce:
 * 1. Nothing is written until "Apply" — the run only ever produces a diff (N4).
 * 2. An accept is exactly one undo step, and the toast says so and offers it.
 * 3. Every state is drawn: idle, running (with progress and a cancel), nothing-to-do, error, done.
 * 4. It is fully keyboard operable, and it says out loud what changed (`aria-live`).
 */

import { LAYOUT_DESCRIPTORS, explainLayout, type LayoutDirection } from '@nexus/layout';
import { Banner, Button, Spinner } from '@nexus/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { applyLayoutDiff } from './applyLayout.ts';
import { useAutoArrangeStore } from './autoArrangeStore.ts';
import { graphFromDoc } from './graphFromDoc.ts';
import { createLayoutRunner, type LayoutRunner, type WorkerFactory } from './runner.ts';
import { applyScope } from '@nexus/layout';

export interface BoardHistoryLike {
  undo: () => void;
}

export interface AutoArrangePanelProps {
  doc: Y.Doc;
  history: BoardHistoryLike;
  selectedIds: readonly string[];
  /** Injected in tests; production uses the module worker. */
  workerFactory?: WorkerFactory | null;
  onApplied?: (count: number) => void;
}

const DIRECTIONS: readonly LayoutDirection[] = ['down', 'up', 'right', 'left'];

export function AutoArrangePanel({
  doc,
  history,
  selectedIds,
  workerFactory,
  onApplied,
}: AutoArrangePanelProps) {
  const store = useAutoArrangeStore();
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const runnerRef = useRef<LayoutRunner | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  if (runnerRef.current === null) {
    runnerRef.current = createLayoutRunner(workerFactory === undefined ? undefined : workerFactory);
  }
  useEffect(() => () => runnerRef.current?.dispose(), []);

  const descriptor = useMemo(
    () => LAYOUT_DESCRIPTORS.find((entry) => entry.id === store.algorithm) ?? LAYOUT_DESCRIPTORS[0],
    [store.algorithm],
  );

  const { open, algorithm, scope, options, status, diff } = store;
  const { started, progressed, previewed, failed, reset, setOpen } = store;

  const preview = useCallback(() => {
    const runner = runnerRef.current;
    if (runner === null) return;
    const board = graphFromDoc(doc);
    const scoped =
      scope === 'selection'
        ? applyScope(board, { kind: 'selection', ids: selectedIds })
        : { graph: board, excluded: [] };
    started();
    void runner
      .run(
        scoped.graph,
        {
          algorithm,
          seed: options.seed,
          spacingX: options.spacingX,
          spacingY: options.spacingY,
          direction: options.direction,
          iterations: options.iterations,
        },
        { onProgress: progressed },
      )
      .then((result) => {
        // `null` means the run was cancelled or superseded: leave the surface as the user left it.
        if (result !== null) previewed(result);
      })
      .catch((error: unknown) => {
        failed(error instanceof Error ? error.message : 'The layout could not be computed.');
      });
  }, [doc, scope, selectedIds, algorithm, options, started, progressed, previewed, failed]);

  const apply = useCallback(() => {
    if (diff === null) return;
    const count = applyLayoutDiff(doc, diff, new Date().toISOString());
    setAppliedCount(count);
    onApplied?.(count);
    reset();
    setOpen(false);
  }, [diff, doc, onApplied, reset, setOpen]);

  const cancel = useCallback(() => {
    runnerRef.current?.cancel();
    reset();
  }, [reset]);

  // Escape cancels the run and closes, in that order — the §15.1 "close top overlay" rule.
  useEffect(() => {
    if (!open) return undefined;
    headingRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (status === 'running' || diff !== null) cancel();
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, status, diff, cancel, setOpen]);

  if (!open) {
    return appliedCount === null ? null : (
      <AppliedToast
        count={appliedCount}
        onUndo={() => {
          history.undo();
          setAppliedCount(null);
        }}
        onDismiss={() => setAppliedCount(null)}
      />
    );
  }

  const emptyBoard = graphFromDoc(doc).nodes.length === 0;
  const selectionTooSmall = scope === 'selection' && selectedIds.length < 2;

  return (
    <section className="nx-layout-panel" data-testid="auto-arrange-panel" aria-label="Auto arrange">
      <h2 tabIndex={-1} ref={headingRef}>
        Auto arrange
      </h2>

      <fieldset>
        <legend>Scope</legend>
        <label htmlFor="auto-arrange-scope-board">
          <input
            id="auto-arrange-scope-board"
            type="radio"
            name="auto-arrange-scope"
            checked={scope === 'board'}
            onChange={() => store.setScope('board')}
          />
          Whole board
        </label>
        <label htmlFor="auto-arrange-scope-selection">
          <input
            id="auto-arrange-scope-selection"
            type="radio"
            name="auto-arrange-scope"
            checked={scope === 'selection'}
            onChange={() => store.setScope('selection')}
          />
          Selection ({String(selectedIds.length)})
        </label>
      </fieldset>

      <label htmlFor="auto-arrange-algorithm">Layout</label>
      <select
        id="auto-arrange-algorithm"
        value={algorithm}
        onChange={(event) => {
          const next = LAYOUT_DESCRIPTORS.find((entry) => entry.id === event.target.value);
          if (next !== undefined) store.setAlgorithm(next.id);
        }}
      >
        {LAYOUT_DESCRIPTORS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      <p className="nx-muted" data-testid="auto-arrange-description">
        {descriptor?.description ?? ''}
      </p>

      {descriptor?.options.includes('direction') === true ? (
        <>
          <label htmlFor="auto-arrange-direction">Direction</label>
          <select
            id="auto-arrange-direction"
            value={options.direction}
            onChange={(event) =>
              store.setOption('direction', event.target.value as LayoutDirection)
            }
          >
            {DIRECTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {descriptor?.options.includes('spacingX') === true ? (
        <>
          <label htmlFor="auto-arrange-spacing-x">Gap between nodes</label>
          <input
            id="auto-arrange-spacing-x"
            type="range"
            min={16}
            max={240}
            step={8}
            value={options.spacingX}
            onChange={(event) => store.setOption('spacingX', Number(event.target.value))}
          />
        </>
      ) : null}

      {descriptor?.options.includes('spacingY') === true ? (
        <>
          <label htmlFor="auto-arrange-spacing-y">Gap between rows</label>
          <input
            id="auto-arrange-spacing-y"
            type="range"
            min={24}
            max={400}
            step={8}
            value={options.spacingY}
            onChange={(event) => store.setOption('spacingY', Number(event.target.value))}
          />
        </>
      ) : null}

      {descriptor?.options.includes('iterations') === true ? (
        <>
          <label htmlFor="auto-arrange-iterations">Settling passes</label>
          <input
            id="auto-arrange-iterations"
            type="range"
            min={20}
            max={400}
            step={20}
            value={options.iterations}
            onChange={(event) => store.setOption('iterations', Number(event.target.value))}
          />
        </>
      ) : null}

      {descriptor?.options.includes('seed') === true ? (
        <>
          <label htmlFor="auto-arrange-seed">Variation</label>
          <input
            id="auto-arrange-seed"
            type="number"
            min={1}
            max={9999}
            value={options.seed}
            onChange={(event) => store.setOption('seed', Number(event.target.value) || 1)}
          />
        </>
      ) : null}

      <div className="nx-layout-panel-actions">
        <Button
          onClick={preview}
          disabled={status === 'running' || emptyBoard || selectionTooSmall}
          data-testid="auto-arrange-preview"
        >
          Preview
        </Button>
        <Button
          variant="secondary"
          onClick={apply}
          disabled={diff === null || diff.moves.length === 0}
          data-testid="auto-arrange-apply"
        >
          Apply
        </Button>
        <Button variant="secondary" onClick={cancel} data-testid="auto-arrange-cancel">
          {status === 'running' ? 'Stop' : 'Discard'}
        </Button>
      </div>

      <div role="status" aria-live="polite" data-testid="auto-arrange-status">
        {emptyBoard ? 'Nothing to lay out yet.' : null}
        {!emptyBoard && selectionTooSmall
          ? 'Select at least two nodes to arrange a selection.'
          : null}
        {status === 'running' ? (
          <span className="nx-layout-progress">
            <Spinner />
            Arranging… {String(Math.round(store.progress * 100))}%
          </span>
        ) : null}
        {status === 'empty'
          ? 'This board is already arranged that way — nothing would move.'
          : null}
        {status === 'preview' && diff !== null ? explainLayout(diff) : null}
      </div>

      {status === 'error' ? (
        <Banner kind="danger" title="Auto arrange failed">
          {store.error ?? 'The layout could not be computed.'}
        </Banner>
      ) : null}
    </section>
  );
}

function AppliedToast({
  count,
  onUndo,
  onDismiss,
}: {
  count: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="nx-layout-toast" role="status" aria-live="polite" data-testid="layout-toast">
      <span>
        Arranged {String(count)} node{count === 1 ? '' : 's'}. One undo puts them back.
      </span>
      <Button variant="secondary" onClick={onUndo} data-testid="layout-toast-undo">
        Undo
      </Button>
      <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss">
        ×
      </Button>
    </div>
  );
}
