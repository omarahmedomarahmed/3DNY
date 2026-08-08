import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The source popover cannot break the surfaces it sits on.
 *
 * It is rendered into a portal on `document.body`, because most of the cards
 * it appears in clip their overflow. That solves the clipping and creates one
 * specific hazard: every dismiss-on-outside-click handler on this map decides
 * "outside" by asking whether the click landed inside its own element, and by
 * that test the popover is always outside. Reading where a rent came from
 * would close the card the rent was on — or, worse, close Compare, which is
 * the surface a broker has spent a minute assembling.
 *
 * `isInsideSourcePopover` is the fix. This test is what stops the NEXT
 * dismissible surface being written without it: it finds every capture-phase
 * document click listener in the UI and insists it consults the helper.
 *
 * The same reasoning as tests/no-agent-info.ts — a rule that lives only in a
 * comment is a rule that gets broken by someone who never read the comment.
 */

const UI_ROOTS = ['src/components', 'src/app'];

/** The component that owns the popover; it checks its own ref instead. */
const OWNER = join('src', 'components', 'ui', 'SourceInfo.tsx');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = UI_ROOTS.flatMap(sourceFiles);
const read = (f: string) => readFileSync(f, 'utf8');

describe('every dismiss-on-outside-click surface knows about the popover', () => {
  it('has UI files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds the surfaces that dismiss on an outside click', () => {
    const dismissers = files.filter((f) =>
      /addEventListener\(\s*'click'[\s\S]{0,120}?true\s*\)/.test(read(f)),
    );
    // If this drops to zero the regex has rotted and the test below is vacuous.
    expect(dismissers.length).toBeGreaterThanOrEqual(2);
  });

  it('and each one exempts the source popover', () => {
    const offenders = files.filter((f) => {
      if (f === OWNER) return false;
      const src = read(f);
      if (!/addEventListener\(\s*'click'[\s\S]{0,120}?true\s*\)/.test(src)) return false;
      return !src.includes('isInsideSourcePopover');
    });
    expect(offenders).toEqual([]);
  });
});

describe('the popover marks itself so it can be recognised', () => {
  const src = read(OWNER);

  it('stamps the portal with the attribute the helper looks for', () => {
    expect(src).toContain('data-source-popover');
    expect(src).toContain("closest('[data-source-popover]')");
  });

  it('renders into a portal rather than inline', () => {
    // Inline, it would be sliced in half by the popup, table cell or panel it
    // lives in — every one of which clips its overflow.
    expect(src).toContain('createPortal');
  });

  it('stops the click reaching whatever it is nested inside', () => {
    // The marker sits inside cards that select a space and rows that open a
    // building. Asking where a number came from is not asking to navigate.
    expect(src).toContain('e.stopPropagation()');
    expect(src).toContain('e.preventDefault()');
  });

  it('is a real button with an accessible name', () => {
    expect(src).toContain('aria-label={`Where ${label} came from`}');
    expect(src).toContain('aria-expanded={open}');
  });

  it('closes only itself on Escape', () => {
    // Without stopping the keypress, one Escape would dismiss the popover AND
    // the space popup underneath it.
    expect(src).toMatch(/e\.key !== 'Escape'[\s\S]{0,200}e\.stopPropagation\(\)/);
  });

  it('is never Goldenrod', () => {
    // On this map Goldenrod means one thing: available space. Forty small
    // Goldenrod marks would be forty claims on the attention the bands own.
    // Comments stripped, so the note explaining the rule does not trip it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/goldenrod/i);
  });
});
