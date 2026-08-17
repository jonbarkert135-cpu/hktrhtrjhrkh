import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

export interface MenuProps {
  /** The control that opens the menu; must be a single focusable element. */
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}

/** Dropdown menu (Radix): typeahead, roving focus, collision-aware placement. */
export function Menu({ trigger, children, align = 'start' }: MenuProps) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className="nx-menu" align={align} sideOffset={8} collisionPadding={8}>
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export interface MenuItemProps {
  onSelect?: () => void;
  disabled?: boolean;
  kind?: 'default' | 'danger';
  children: ReactNode;
}

export function MenuItem({ onSelect, disabled, kind = 'default', children }: MenuItemProps) {
  return (
    <RadixMenu.Item
      className="nx-menu-item"
      data-kind={kind}
      disabled={disabled ?? false}
      onSelect={() => onSelect?.()}
    >
      {children}
    </RadixMenu.Item>
  );
}
