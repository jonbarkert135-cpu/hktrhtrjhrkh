import { useEffect, useId, useState, type FormEvent } from 'react';
import { Banner, Button, Dialog, Field } from '@nexus/ui';

export interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. "New project". */
  title: string;
  /** Field label. Kept generic so the journey specs can address it as "Name". */
  label?: string;
  description?: string;
  submitting?: boolean;
  /** Already mapped through lib/trpc errorMessage() by the caller. */
  error?: string | undefined;
  onSubmit: (name: string) => void;
  /** Pre-fills the field (rename) instead of starting blank (create). */
  initialValue?: string | undefined;
  /** Defaults to "Create"; renaming passes "Rename". */
  submitLabel?: string;
}

/**
 * One-field "name it and create it" dialog, shared by projects and boards (03_UX.md §7.2:
 * creation never leaves the surface the user is on). Pure: the caller owns the mutation.
 */
export function CreateDialog({
  open,
  onOpenChange,
  title,
  label = 'Name',
  description,
  submitting = false,
  error,
  onSubmit,
  initialValue,
  submitLabel = 'Create',
}: CreateDialogProps) {
  const formId = useId();
  const [name, setName] = useState(initialValue ?? '');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  // Reopening must not show what the last attempt typed (create) or a stale value (rename).
  useEffect(() => {
    if (open) {
      setName(initialValue ?? '');
      setFieldError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (value === '') {
      setFieldError('Enter a name so you can find this again.');
      return;
    }
    setFieldError(undefined);
    onSubmit(value);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description === undefined ? {} : { description })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={submitting} disabled={submitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner
          kind="danger"
          title={`Couldn't create that ${title.toLowerCase().replace(/^new /, '')}`}
        >
          {error}
        </Banner>
      ) : null}
      <form id={formId} className="nx-stack" onSubmit={submit} noValidate>
        <Field
          label={label}
          {...(fieldError === undefined ? {} : { error: fieldError })}
          name="name"
          autoComplete="off"
          value={name}
          disabled={submitting}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
