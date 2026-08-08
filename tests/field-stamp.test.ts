import { describe, expect, it } from 'vitest';
import { fieldSourceAssignment, tableIsStamped } from '../src/lib/field-stamp';

/**
 * The stamp is what stops a corrected value from going on claiming it came off
 * a sheet. Two failure modes are worth holding here, and both are silent:
 *
 * - Stamping a field that did not change. Saving an untouched form would then
 *   rewrite the provenance of every field on it, which is the exact opposite of
 *   what this is for. The guard is a server-side comparison, so this test reads
 *   the emitted SQL for it.
 *
 * - Numbering the parameters wrong. The two writers build their parameter lists
 *   differently — one puts the id first, the other last — so the fragment has
 *   to place its own placeholders relative to whatever is already there.
 */

describe('only the tables that have the column get stamped', () => {
  it('stamps spaces and buildings', () => {
    expect(tableIsStamped('spaces')).toBe(true);
    expect(tableIsStamped('buildings')).toBe(true);
  });

  it('leaves the hand-kept tables alone', () => {
    // Every field on a landlord or a tenant is hand-authored already; a
    // per-field stamp there would say nothing the record does not.
    for (const table of ['landlords', 'tenants', 'imports', 'address_aliases']) {
      expect(tableIsStamped(table), table).toBe(false);
      expect(fieldSourceAssignment(table, { name: 'x' }, [])).toBe('');
    }
  });
});

describe('the emitted assignment', () => {
  it('compares against the row as it was, not as it will be', () => {
    const sql = fieldSourceAssignment('spaces', { sf: 1000 }, []);
    // `to_jsonb(t)` inside an UPDATE is the OLD row. Without this comparison
    // an unchanged field would be stamped as if somebody had retyped it.
    expect(sql).toContain('to_jsonb(t) -> e.key IS DISTINCT FROM e.value');
  });

  it('merges rather than replaces, so older stamps survive', () => {
    const sql = fieldSourceAssignment('spaces', { sf: 1000 }, []);
    expect(sql).toContain('t.field_sources || (');
  });

  it('never produces NULL when nothing changed', () => {
    // jsonb_object_agg over zero rows is NULL, and `x || NULL` is NULL — which
    // would wipe every stamp on the row.
    expect(fieldSourceAssignment('spaces', { sf: 1 }, [])).toContain("'{}'::jsonb");
  });

  it('writes nothing at all when the statement writes no columns', () => {
    expect(fieldSourceAssignment('spaces', {}, [])).toBe('');
  });
});

describe('parameter numbering', () => {
  it('places its placeholders after everything already in the list', () => {
    // The edit drawer's shape: id first, then the values.
    const values: unknown[] = ['id-1', 1000, 88];
    const sql = fieldSourceAssignment('spaces', { sf: 1000, asking_rent_psf: 88 }, values);
    expect(values).toHaveLength(5);
    expect(sql).toContain('$4::jsonb');
    expect(sql).toContain('$5::text');
  });

  it('works just as well when the id is pushed last', () => {
    // The admin grid's shape: values, then the id.
    const values: unknown[] = [1000, 'id-1'];
    const sql = fieldSourceAssignment('spaces', { sf: 1000 }, values);
    expect(values).toHaveLength(4);
    expect(sql).toContain('$3::jsonb');
    expect(sql).toContain('$4::text');
  });

  it('passes the written columns as the JSON to compare against', () => {
    const values: unknown[] = ['id-1'];
    fieldSourceAssignment('spaces', { sf: 1000, notes: null }, values);
    expect(JSON.parse(values[1] as string)).toEqual({ sf: 1000, notes: null });
  });

  it('defaults to a hand edit and takes any other kind', () => {
    const manual: unknown[] = [];
    fieldSourceAssignment('spaces', { sf: 1 }, manual);
    expect(manual[1]).toBe('manual');

    const synced: unknown[] = [];
    fieldSourceAssignment('spaces', { sf: 1 }, synced, 'salesforce');
    expect(synced[1]).toBe('salesforce');
  });
});
