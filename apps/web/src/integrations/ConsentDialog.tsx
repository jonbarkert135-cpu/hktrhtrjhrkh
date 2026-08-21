/**
 * The authorization gate (10_INTEGRATIONS.md §12.1, §7.2 step 3).
 *
 * Names the tool, the targets and what leaves the device, and keeps "Run" disabled until the
 * checkbox is ticked — the checkbox is the record we later have to prove was shown, so its wording
 * is the manifest's `consent.scopeText` verbatim, never a paraphrase.
 */

import { Button, Dialog } from '@nexus/ui';
import { useEffect, useState } from 'react';

import type { IntegrationSummary } from './types.ts';

export interface ConsentDialogProps {
  open: boolean;
  integration: IntegrationSummary | null;
  targets: readonly { kind: string; value: string }[];
  onCancel: () => void;
  onConfirm: (integration: IntegrationSummary) => void;
  /** Set after `CONSENT_EXPIRED`: the dialog reopens pre-filled with the reason (§8). */
  notice?: string | null;
}

/** What leaves the device — the honest answer, which for a builtin is "nothing". */
export function dataLeavingCopy(integration: IntegrationSummary): string {
  return integration.executionKind === 'builtin'
    ? 'Nothing leaves this deployment: this tool runs locally, in the sandbox.'
    : 'This tool contacts third-party services on your behalf with the inputs shown above.';
}

export function ConsentDialog({
  open,
  integration,
  targets,
  onCancel,
  onConfirm,
  notice,
}: ConsentDialogProps) {
  const [checked, setChecked] = useState(false);

  // Consent is never remembered across openings for a high-risk tool (§7.2 step 3); resetting on
  // every open is the same rule applied to every tool, which is one branch fewer to get wrong.
  useEffect(() => {
    if (open) setChecked(false);
  }, [open, integration?.id]);

  if (integration === null) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={`Run ${integration.name}`}
      description={integration.description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!checked} onClick={() => onConfirm(integration)}>
            Run
          </Button>
        </>
      }
    >
      {notice === null || notice === undefined ? null : (
        <p className="nx-muted" data-testid="consent-notice">
          {notice}
        </p>
      )}

      <p data-testid="consent-targets">
        Targets:{' '}
        {targets.length === 0
          ? 'none selected'
          : targets.map((target) => `${target.value} (${target.kind})`).join(', ')}
      </p>
      <p data-testid="consent-data">{dataLeavingCopy(integration)}</p>

      {integration.risk.reasons.length === 0 ? null : (
        <ul data-testid="consent-risks">
          {integration.risk.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <label className="nx-checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        {integration.consent.scopeText}
      </label>
    </Dialog>
  );
}
