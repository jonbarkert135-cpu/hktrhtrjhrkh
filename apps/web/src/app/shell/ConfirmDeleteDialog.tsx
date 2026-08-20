import { useEffect, useId, useState, type FormEvent } from 'react';
import { Banner, Button, Dialog, Field } from '@nexus/ui';

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "project" or "board" — used in copy only. */
  kind: string;
  /** The exact name the user must retype (case-sensitive) to confirm. */
  name: string;
  submitting?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
}

/**
 * Deleting a project or board is not a CRDT operation and has no undo step (P7 §14): it needs its
 * own, explicit confirmation instead of relying on Ctrl/Cmd+Z. Typing the exact name is that
 * confirmation.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  kind,
  name,
  submitting = false,
  error,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const formId = useId();
  const [typed, setTyped] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setTyped('');
      setFieldError(undefined);
    }
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed !== name) {
      setFieldError(`Type "${name}" exactly to confirm.`);
      return;
    }
    setFieldError(undefined);
    onConfirm();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete this ${kind}?`}
      description={`This cannot be undone with Ctrl/Cmd+Z. It moves to Recently deleted for 30 days, then is purged for good.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="danger"
            loading={submitting}
            disabled={submitting}
          >
            Delete
          </Button>
        </>
      }
    >
      {error ? (
        <Banner kind="danger" title={`Couldn't delete this ${kind}`}>
          {error}
        </Banner>
      ) : null}
      <form id={formId} className="nx-stack" onSubmit={submit} noValidate>
        <Field
          label={`Type "${name}" to confirm`}
          {...(fieldError === undefined ? {} : { error: fieldError })}
          name="confirmName"
          autoComplete="off"
          value={typed}
          disabled={submitting}
          onChange={(event) => setTyped(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
