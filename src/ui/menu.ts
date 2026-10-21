// Right-click menus that a part of the page provides itself (a sheet grid). ContextMenu.tsx asks the nearest one first.
export type MenuItem = { label: string; keys?: string; run: () => unknown; off?: boolean } | "-";

const owners = new WeakMap<Element, (e: MouseEvent) => MenuItem[]>();

export const ownMenu = (el: Element, items: (e: MouseEvent) => MenuItem[]): void => void owners.set(el, items);

/** The menu of the nearest element under `e` that provides one. */
export function menuFor(e: MouseEvent): MenuItem[] | null {
  for (let el = e.target as Element | null; el; el = el.parentElement) {
    const f = owners.get(el);
    if (f) return f(e);
  }
  return null;
}
