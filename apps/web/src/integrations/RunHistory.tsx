/**
 * Run history for a board (10_INTEGRATIONS.md §7.2 step 7, §7.5, §7.6).
 *
 * Reverse-chronological, filterable by integration and status, one click to the log, a re-run or a
 * diff with the previous run of the same integration.
 */

import { Button } from '@nexus/ui';
import { useState } from 'react';

import type { IntegrationSummary, RunRow } from './types.ts';

export interface RunHistoryProps {
  runs: readonly RunRow[];
  integrations: readonly IntegrationSummary[];
  onViewLog: (run: RunRow) => void;
  onRerun: (run: RunRow) => void;
  onDiff: (run: RunRow, previous: RunRow) => void;
}

/** The previous run of the same integration, if there is one (§7.6). */
export function previousRunOf(runs: readonly RunRow[], run: RunRow): RunRow | undefined {
  const sameTool = runs
    .filter((other) => other.integrationId === run.integrationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sameTool[sameTool.findIndex((other) => other.id === run.id) + 1];
}

export function RunHistory({ runs, integrations, onViewLog, onRerun, onDiff }: RunHistoryProps) {
  const [integrationId, setIntegrationId] = useState('');
  const [status, setStatus] = useState('');

  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = sorted.filter(
    (run) =>
      (integrationId === '' || run.integrationId === integrationId) &&
      (status === '' || run.status === status),
  );
  const nameOf = (id: string): string =>
    integrations.find((integration) => integration.id === id)?.name ?? id;

  return (
    <section aria-label="Run history" data-testid="run-history">
      <label>
        Integration
        <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
          <option value="">All</option>
          {integrations.map((integration) => (
            <option key={integration.id} value={integration.id}>
              {integration.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {[...new Set(sorted.map((run) => run.status))].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      {runs.length === 0 ? (
        <p data-testid="history-empty">
          No tool has run on this board yet. Select a node and choose “Run integration…” to start
          one — every run you make is listed here with its log.
        </p>
      ) : null}

      <ul>
        {visible.map((run) => {
          const previous = previousRunOf(sorted, run);
          return (
            <li key={run.id} data-testid="run-row">
              <span>{new Date(run.createdAt).toISOString()}</span>{' '}
              <span>{nameOf(run.integrationId)}</span>{' '}
              <span data-testid="run-status">{run.status}</span>{' '}
              <span>{run.durationMs === null ? '—' : `${String(run.durationMs)}ms`}</span>
              <Button variant="secondary" onClick={() => onViewLog(run)}>
                View run log
              </Button>
              <Button variant="secondary" onClick={() => onRerun(run)}>
                Re-run
              </Button>
              <Button
                variant="secondary"
                disabled={previous === undefined}
                onClick={() => {
                  if (previous !== undefined) onDiff(run, previous);
                }}
              >
                Diff with previous
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
