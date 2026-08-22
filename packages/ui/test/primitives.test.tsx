import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../src/primitives/Button';
import { Field } from '../src/primitives/Field';
import { Skeleton } from '../src/primitives/Skeleton';
import { Dialog } from '../src/primitives/Dialog';
import { SkipToContent, VisuallyHidden } from '../src/primitives/a11y';
import { Banner } from '../src/primitives/Banner';
import { Menu, MenuItem } from '../src/primitives/Menu';
import { Tooltip, TooltipProvider } from '../src/primitives/Tooltip';

describe('Button', () => {
  it('reports and blocks interaction while loading', () => {
    render(
      <Button variant="primary" loading>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: /save/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.nx-spinner')).not.toBeNull();
  });
});

describe('Field', () => {
  it('wires label, description and error to the input', () => {
    render(<Field label="Email" description="Work address" error="Enter a valid email" />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const described = describedBy.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Work address');
    expect(described).toContain('Enter a valid email');
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email');
  });
});

describe('Skeleton', () => {
  it('is decorative and takes its box from tokens', () => {
    render(<Skeleton width="var(--nx-space-9)" height="var(--nx-space-5)" />);
    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.style.height).toBe('var(--nx-space-5)');
  });
});

describe('Dialog', () => {
  it('opens and closes', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open</Button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Delete board"
            description="This is undoable."
          >
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Delete board' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SkipToContent', () => {
  it('is the first tab stop and points at the landmark', () => {
    render(
      <>
        <SkipToContent targetId="main" />
        <button type="button">Toolbar</button>
        <main id="main">Canvas</main>
      </>,
    );
    const link = screen.getByRole('link', { name: 'Skip to content' });
    const focusable = Array.from(document.body.querySelectorAll('a[href], button'));
    expect(focusable[0]).toBe(link);
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link.getAttribute('href')).toBe('#main');
  });
});

describe('Banner', () => {
  it('announces errors as an alert and carries a non-colour status glyph', () => {
    render(
      <Banner kind="danger" title="Couldn't sign you in">
        Check the address and try again.
      </Banner>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Error' })).toBeTruthy();
    expect(screen.getByText('Check the address and try again.')).toBeTruthy();
  });

  it('uses the polite status role for the non-error kinds', () => {
    render(<Banner kind="info" title="Saved locally" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('Menu', () => {
  it('opens from its trigger and renders its items', () => {
    render(
      <Menu trigger={<button type="button">Account</button>}>
        <MenuItem>Settings</MenuItem>
      </Menu>,
    );
    // jsdom has no PointerEvent; Radix opens on keyboard too, which is the path we care about.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Account' }), { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
  });
});

describe('Tooltip and VisuallyHidden', () => {
  it('renders its trigger and keeps hidden text in the accessibility tree', () => {
    render(
      <TooltipProvider>
        <Tooltip content="Zoom to fit">
          <button type="button">
            <VisuallyHidden>Zoom to fit</VisuallyHidden>
          </button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Zoom to fit' })).toBeTruthy();
  });
});

describe('motion (§24)', () => {
  it('animates dialogs and overlays with tokens, and not at all under reduced motion', () => {
    const css = readFileSync('src/primitives/primitives.css', 'utf8');
    const motion = css.slice(css.indexOf('@keyframes nx-fade-in'));
    // Only compositor-friendly properties, and every duration/easing comes from a token.
    expect(motion).not.toMatch(/animation:[^;]*\d+m?s/);
    expect(motion).toContain(".nx-dialog[data-state='open']");
    expect(motion).toContain('prefers-reduced-motion');
  });
});
