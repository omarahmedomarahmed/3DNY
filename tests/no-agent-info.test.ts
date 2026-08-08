import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Named agents and their email addresses are never displayed.
 *
 * This product is used by a leasing firm, live, in front of a client. The
 * weekly sheet carries the competitor's named broker and their inbox, so both
 * are parsed and stored — dropping a source column would make the import
 * lossy — but neither is ever put on screen.
 *
 * A code comment is not enough to hold that: the fields exist on the type, so
 * anyone building a new table or card will see `agent_name` in autocomplete
 * and reasonably reach for it. This test is the thing that says no.
 *
 * It reads the UI source rather than rendering, because the point is to catch
 * the field being referenced at all, in any component, however it is styled.
 */

const UI_ROOTS = ['src/components', 'src/app'];

/** Files that are allowed to mention the fields, and why. */
const ALLOWED = new Set<string>([
  // Nothing. The parser and the schema live outside src/components and
  // src/app, which is exactly the separation being enforced.
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strips comments, so the notes explaining the rule do not trip the rule. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('agent identity never reaches the UI', () => {
  const files = UI_ROOTS.flatMap(sourceFiles);

  it('has UI files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const field of ['agent_name', 'agent_email', 'agentName', 'agentEmail'] as const) {
    it(`no component or route references ${field}`, () => {
      const offenders = files.filter((file) => {
        if (ALLOWED.has(file)) return false;
        return withoutComments(readFileSync(file, 'utf8')).includes(field);
      });
      expect(offenders).toEqual([]);
    });
  }

  it('the listing firm IS still shown, since that is market context', () => {
    // The opposite failure — stripping the whole leasing column — would lose
    // something genuinely useful. Guard that the firm survived.
    const shown = files.some((file) =>
      withoutComments(readFileSync(file, 'utf8')).includes('leasing_company'),
    );
    expect(shown).toBe(true);
  });
});
