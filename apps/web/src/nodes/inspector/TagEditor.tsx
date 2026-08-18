/**
 * Tag input (P4 §5.7, §6). Free-form with autocomplete from the tags already on the board, and it
 * says out loud why a tag was refused instead of silently dropping it.
 */

import { normalizeTag, suggestTags } from '@nexus/domain';
import { useId, useMemo, useState } from 'react';

export interface TagEditorProps {
  tags: readonly string[];
  /** Every tag set on the board, for the suggestion list. */
  boardTags: ReadonlyArray<readonly string[]>;
  onChange: (tags: string[]) => { rejected: Array<{ message: string }> };
  disabled?: boolean;
}

export function TagEditor({ tags, boardTags, onChange, disabled = false }: TagEditorProps) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();

  const suggestions = useMemo(
    () => suggestTags(boardTags, draft).filter((tag) => !tags.some((t) => t.toLowerCase() === tag.toLowerCase())),
    [boardTags, draft, tags],
  );

  const commit = (value: string): void => {
    const tag = normalizeTag(value);
    if (tag === '') {
      setDraft('');
      return;
    }
    const result = onChange([...tags, tag]);
    setMessage(result.rejected[0]?.message ?? null);
    setDraft('');
  };

  return (
    <div className="nx-tag-editor">
      <div className="nx-chip-row" data-testid="inspector-tags">
        {tags.map((tag) => (
          <span key={tag} className="nx-chip">
            {tag}
            <button
              type="button"
              className="nx-chip-remove"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={() => {
                setMessage(null);
                onChange(tags.filter((value) => value !== tag));
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className="nx-input"
        type="text"
        value={draft}
        list={listId}
        disabled={disabled}
        placeholder="Add a tag"
        aria-label="Add a tag"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit(draft);
        }}
        onBlur={() => {
          if (draft !== '') commit(draft);
        }}
      />
      <datalist id={listId}>
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      {message !== null ? (
        <p className="nx-field-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
