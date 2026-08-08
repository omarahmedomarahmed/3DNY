/**
 * The one place a `field_sources` stamp is written.
 *
 * There are two ways to edit a space or a building in this app — the edit
 * drawer, which goes through `queries.ts`, and the Data admin grid, which goes
 * through `admin-tables.ts` — and both are equally capable of turning a figure
 * that came off a sheet into one somebody typed. If only one of them stamped,
 * the "i" beside a value would keep crediting the sheet for a number the sheet
 * never carried, which is worse than saying nothing at all.
 *
 * So the SQL lives here, once, and both writers call it.
 */

/** Tables carrying the `field_sources` column. */
const STAMPED = new Set(['spaces', 'buildings']);

export function tableIsStamped(table: string): boolean {
  return STAMPED.has(table);
}

/**
 * The `field_sources = ...` assignment to append to an UPDATE, or '' when the
 * table has no such column.
 *
 * Two things this deliberately does NOT do:
 *
 * It does not stamp a field whose value is unchanged. Saving a form without
 * touching it, or re-sending a field at the value it already holds, must not
 * rewrite its provenance — that would erase the very thing the stamp exists to
 * record. The comparison happens server-side against `to_jsonb(t)`, which
 * inside an UPDATE still sees the row as it was, so one statement does the
 * whole job with no read-then-write race.
 *
 * And it does not decide what `kind` is. A CRM sync passes its own.
 *
 * The UPDATE must alias the target table as `t`. `values` is appended to, so
 * call this after every other parameter has been pushed.
 */
export function fieldSourceAssignment(
  table: string,
  /** Only the columns this statement actually writes, name → value. */
  written: Record<string, unknown>,
  /** The statement's parameter list. Two entries are appended. */
  values: unknown[],
  kind = 'manual',
): string {
  if (!STAMPED.has(table)) return '';
  if (Object.keys(written).length === 0) return '';

  values.push(JSON.stringify(written));
  const patchIdx = values.length;
  values.push(kind);
  const kindIdx = values.length;

  return `, field_sources = t.field_sources || (
       SELECT COALESCE(
                jsonb_object_agg(e.key, jsonb_build_object(
                  'kind', $${kindIdx}::text,
                  'at', to_jsonb(now()))),
                '{}'::jsonb)
       FROM jsonb_each($${patchIdx}::jsonb) AS e(key, value)
       WHERE to_jsonb(t) -> e.key IS DISTINCT FROM e.value
     )`;
}
