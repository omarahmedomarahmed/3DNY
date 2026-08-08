import { sql } from './db';

/**
 * The admin data editor: read, edit and delete anything that was imported.
 *
 * Every table, column and sort key is declared here rather than discovered at
 * runtime. Postgres cannot parameterise an identifier, so a table or column
 * name coming from a URL would have to be interpolated into SQL — and the only
 * safe way to interpolate an identifier is to have never accepted one. Names
 * from a request are used solely to look up an entry in this file; the strings
 * that reach the database are the literals below.
 *
 * The app has no sign-in yet, so the destructive operations are deliberately
 * awkward: bulk deletes require the caller to repeat a confirmation phrase that
 * names the table and the row count. That is not security — anyone with the
 * link still has it — but it does mean a wipe cannot happen by mis-click, which
 * is the failure this prototype is actually exposed to.
 */

export type ColumnKind = 'text' | 'number' | 'date' | 'boolean' | 'json' | 'readonly';

export interface AdminColumn {
  name: string;
  label: string;
  kind: ColumnKind;
  /** Shown in the table view. Everything else is edit-only. */
  inGrid?: boolean;
}

export interface AdminTable {
  key: string;
  label: string;
  /** The real table name. Never taken from a request. */
  table: string;
  description: string;
  /** ORDER BY for listings. A literal, for the same reason. */
  orderBy: string;
  columns: AdminColumn[];
  /** Column holding a human label for the row, used in confirmations. */
  titleColumn: string;
  /** True when deleting a row cascades to others. Surfaced in the UI. */
  cascades?: string;
}

const ts: AdminColumn[] = [
  { name: 'created_at', label: 'Created', kind: 'readonly' },
  { name: 'updated_at', label: 'Updated', kind: 'readonly' },
];

export const ADMIN_TABLES: AdminTable[] = [
  {
    key: 'buildings',
    label: 'Buildings',
    table: 'buildings',
    description:
      'One row per physical building. Geometry columns are not editable here — use Refresh building shapes on Setup.',
    orderBy: 'address_display ASC',
    titleColumn: 'address_display',
    cascades: 'Deleting a building also deletes its spaces, tenants and photos.',
    columns: [
      { name: 'id', label: 'ID', kind: 'readonly' },
      { name: 'address_display', label: 'Address', kind: 'text', inGrid: true },
      { name: 'building_name', label: 'Building name', kind: 'text', inGrid: true },
      { name: 'class', label: 'Class', kind: 'text', inGrid: true },
      { name: 'num_floors', label: 'Floors', kind: 'number', inGrid: true },
      { name: 'height_roof_ft', label: 'Roof height (ft)', kind: 'number', inGrid: true },
      { name: 'year_built', label: 'Year built', kind: 'number' },
      { name: 'bldg_area_sf', label: 'Building SF', kind: 'number' },
      { name: 'submarket', label: 'Market', kind: 'text' },
      { name: 'submarket_cluster', label: 'Submarket', kind: 'text', inGrid: true },
      { name: 'bin', label: 'BIN', kind: 'text' },
      { name: 'bbl', label: 'BBL', kind: 'text' },
      { name: 'match_confidence', label: 'Match', kind: 'text', inGrid: true },
      { name: 'floor_height_override', label: 'Floor height override (ft)', kind: 'number' },
      { name: 'address_normalized', label: 'Normalised address', kind: 'readonly' },
      { name: 'landlord_id', label: 'Landlord ID', kind: 'text' },
      { name: 'notes', label: 'Notes', kind: 'text' },
      ...ts,
    ],
  },
  {
    key: 'spaces',
    label: 'Spaces',
    table: 'spaces',
    description: 'Every available space imported from a sheet or added by hand.',
    orderBy: 'updated_at DESC',
    titleColumn: 'floor_label',
    cascades: 'Deleting a space also deletes its photos.',
    columns: [
      { name: 'id', label: 'ID', kind: 'readonly' },
      { name: 'building_id', label: 'Building ID', kind: 'text' },
      { name: 'floor_label', label: 'Floor', kind: 'text', inGrid: true },
      { name: 'floor_number', label: 'Floor no.', kind: 'number' },
      { name: 'floor_portion', label: 'Portion', kind: 'text' },
      { name: 'sf', label: 'SF', kind: 'number', inGrid: true },
      { name: 'asking_rent_psf', label: 'Asking rent', kind: 'number', inGrid: true },
      { name: 'asking_rent_withheld', label: 'Rent withheld', kind: 'boolean' },
      { name: 'space_use', label: 'Use', kind: 'text' },
      { name: 'lease_type', label: 'Type', kind: 'text', inGrid: true },
      { name: 'sub_landlord', label: 'Sublandlord', kind: 'text' },
      { name: 'available_from', label: 'Available', kind: 'date', inGrid: true },
      { name: 'term_expires', label: 'Expires', kind: 'date', inGrid: true },
      { name: 'term_raw', label: 'Term (raw)', kind: 'text' },
      { name: 'occupancy_raw', label: 'Occupancy (raw)', kind: 'text' },
      { name: 'leasing_company', label: 'Leasing company', kind: 'text' },
      { name: 'date_added', label: 'Date added', kind: 'date' },
      { name: 'is_active', label: 'Active', kind: 'boolean', inGrid: true },
      { name: 'notes', label: 'Notes', kind: 'text' },
      ...ts,
    ],
  },
  {
    key: 'landlords',
    label: 'Landlords',
    table: 'landlords',
    description:
      'Ownership entities. Records seeded from city data are flagged for review until someone confirms them.',
    orderBy: 'name ASC',
    titleColumn: 'name',
    cascades: 'Deleting a landlord leaves its buildings without one; it does not delete them.',
    columns: [
      { name: 'id', label: 'ID', kind: 'readonly' },
      { name: 'name', label: 'Name', kind: 'text', inGrid: true },
      { name: 'owner_of_record', label: 'Owner of record', kind: 'text', inGrid: true },
      { name: 'needs_review', label: 'Needs review', kind: 'boolean', inGrid: true },
      { name: 'source', label: 'Source', kind: 'text', inGrid: true },
      { name: 'portfolio_sf', label: 'Portfolio SF', kind: 'number' },
      { name: 'buildings_owned', label: 'Buildings owned', kind: 'number', inGrid: true },
      { name: 'avg_asking_rent', label: 'Avg asking rent', kind: 'number' },
      { name: 'contact_name', label: 'Contact', kind: 'text' },
      { name: 'contact_email', label: 'Contact email', kind: 'text' },
      { name: 'contact_phone', label: 'Contact phone', kind: 'text' },
      { name: 'insights_md', label: 'Insights', kind: 'text' },
      { name: 'amenities', label: 'Amenities', kind: 'json' },
      { name: 'notable_tenants', label: 'Notable tenants', kind: 'json' },
      { name: 'aliases', label: 'Aliases', kind: 'json' },
      { name: 'updated_at', label: 'Updated', kind: 'readonly' },
    ],
  },
  {
    key: 'tenants',
    label: 'Tenants',
    table: 'tenants',
    description: 'Existing tenants in a building, from a sheet or entered by hand.',
    orderBy: 'company_name ASC',
    titleColumn: 'company_name',
    columns: [
      { name: 'id', label: 'ID', kind: 'readonly' },
      { name: 'building_id', label: 'Building ID', kind: 'text' },
      { name: 'company_name', label: 'Company', kind: 'text', inGrid: true },
      { name: 'floors', label: 'Floors', kind: 'text', inGrid: true },
      { name: 'sf', label: 'SF', kind: 'number', inGrid: true },
      { name: 'lease_expiration', label: 'Lease expires', kind: 'date', inGrid: true },
      { name: 'industry', label: 'Industry', kind: 'text', inGrid: true },
      { name: 'source', label: 'Source', kind: 'text' },
      { name: 'notes', label: 'Notes', kind: 'text' },
      ...ts,
    ],
  },
  {
    key: 'space_images',
    label: 'Space photos',
    table: 'space_images',
    description: 'Photos attached to a space. Deleting a row here does not delete the stored file.',
    orderBy: 'uploaded_at DESC',
    titleColumn: 'blob_url',
    columns: [
      { name: 'id', label: 'ID', kind: 'readonly' },
      { name: 'space_id', label: 'Space ID', kind: 'text' },
      { name: 'blob_url', label: 'URL', kind: 'text', inGrid: true },
      { name: 'caption', label: 'Caption', kind: 'text', inGrid: true },
      { name: 'sort_order', label: 'Order', kind: 'number', inGrid: true },
      { name: 'uploaded_at', label: 'Uploaded', kind: 'readonly', inGrid: true },
    ],
  },
  {
    key: 'address_aliases',
    label: 'Address aliases',
    table: 'address_aliases',
    description:
      'Addresses pinned to a building by hand during import review. Delete one to be asked about that address again.',
    orderBy: 'raw_address ASC',
    titleColumn: 'raw_address',
    columns: [
      { name: 'raw_address', label: 'Raw address', kind: 'readonly', inGrid: true },
      { name: 'building_id', label: 'Building ID', kind: 'text', inGrid: true },
      { name: 'created_at', label: 'Created', kind: 'readonly', inGrid: true },
    ],
  },
  {
    key: 'imports',
    label: 'Imports',
    table: 'imports',
    description: 'One row per uploaded sheet. Deleting a row leaves its spaces in place.',
    orderBy: 'uploaded_at DESC',
    titleColumn: 'filename',
    columns: [
      { name: 'id', label: 'ID', kind: 'readonly' },
      { name: 'filename', label: 'File', kind: 'readonly', inGrid: true },
      { name: 'market_label', label: 'Market', kind: 'text', inGrid: true },
      { name: 'row_count', label: 'Rows', kind: 'number', inGrid: true },
      { name: 'matched_exact', label: 'Exact', kind: 'number', inGrid: true },
      { name: 'matched_fuzzy', label: 'Fuzzy', kind: 'number', inGrid: true },
      { name: 'unmatched', label: 'Unmatched', kind: 'number', inGrid: true },
      { name: 'status', label: 'Status', kind: 'text', inGrid: true },
      { name: 'uploaded_at', label: 'Uploaded', kind: 'readonly', inGrid: true },
    ],
  },
];

export function findTable(key: string): AdminTable | null {
  return ADMIN_TABLES.find((t) => t.key === key) ?? null;
}

/** The primary key column. Every table uses `id` except the alias table. */
export function primaryKey(spec: AdminTable): string {
  return spec.table === 'address_aliases' ? 'raw_address' : 'id';
}

export function editableColumns(spec: AdminTable): AdminColumn[] {
  return spec.columns.filter((c) => c.kind !== 'readonly');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function countRows(spec: AdminTable): Promise<number> {
  const db = sql();
  const rows = (await db(`SELECT count(*)::int AS n FROM ${spec.table}`)) as any[];
  return rows[0]?.n ?? 0;
}

export async function listRows(
  spec: AdminTable,
  opts: { limit: number; offset: number; search?: string },
): Promise<{ rows: any[]; total: number }> {
  const db = sql();
  const cols = spec.columns.map((c) => c.name).join(', ');

  // Search runs across the title column only. A cross-column search would mean
  // building a predicate from request data, which is exactly what this module
  // exists to avoid.
  const where = opts.search ? `WHERE ${spec.titleColumn}::text ILIKE $3` : '';
  const params: any[] = [opts.limit, opts.offset];
  if (opts.search) params.push(`%${opts.search}%`);

  const rows = (await db(
    `SELECT ${cols} FROM ${spec.table} ${where} ORDER BY ${spec.orderBy} LIMIT $1 OFFSET $2`,
    params,
  )) as any[];

  const totalRows = (await db(
    `SELECT count(*)::int AS n FROM ${spec.table} ${where ? `WHERE ${spec.titleColumn}::text ILIKE $1` : ''}`,
    opts.search ? [`%${opts.search}%`] : [],
  )) as any[];

  return { rows, total: totalRows[0]?.n ?? 0 };
}

/** Coerces an incoming value to something the column will accept. */
function coerce(column: AdminColumn, raw: unknown): unknown {
  if (raw === '' || raw === null || raw === undefined) return null;
  switch (column.kind) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case 'json':
      if (Array.isArray(raw)) return raw;
      return String(raw)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    default:
      return String(raw);
  }
}

export async function updateRow(
  spec: AdminTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<any | null> {
  const editable = editableColumns(spec);
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const column of editable) {
    if (!(column.name in patch)) continue;
    values.push(coerce(column, patch[column.name]));
    sets.push(`${column.name} = $${values.length}`);
  }
  if (sets.length === 0) return null;

  values.push(id);
  const db = sql();
  const rows = (await db(
    `UPDATE ${spec.table} SET ${sets.join(', ')} WHERE ${primaryKey(spec)} = $${values.length} RETURNING *`,
    values,
  )) as any[];
  return rows[0] ?? null;
}

export async function deleteRow(spec: AdminTable, id: string): Promise<boolean> {
  const db = sql();
  const rows = (await db(
    `DELETE FROM ${spec.table} WHERE ${primaryKey(spec)} = $1 RETURNING ${primaryKey(spec)}`,
    [id],
  )) as any[];
  return rows.length > 0;
}

/** The phrase a caller must repeat to empty a table. */
export function wipePhrase(spec: AdminTable, total: number): string {
  return `DELETE ${total} ${spec.key}`;
}

export async function deleteAll(
  spec: AdminTable,
  confirmation: string,
): Promise<{ deleted: number }> {
  const total = await countRows(spec);
  if (confirmation !== wipePhrase(spec, total)) {
    throw new Error(
      `To empty this table, send the confirmation phrase exactly: "${wipePhrase(spec, total)}".`,
    );
  }
  const db = sql();
  await db(`DELETE FROM ${spec.table}`);
  return { deleted: total };
}
