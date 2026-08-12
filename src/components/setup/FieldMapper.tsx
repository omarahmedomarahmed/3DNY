'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';

/**
 * Lining a report's columns up with ours, against the org's own rows.
 *
 * The mapping table alone is a guess. The preview beside it is what makes this
 * checkable: "Building" and "Building Address" are both plausible-looking
 * choices until you see `One Grand Central Place` sitting in the address
 * column, at which point the mistake is obvious and takes one click to fix.
 *
 * The suggestion is a starting point, never the final word. It gets a normal
 * Ascendix report mostly right, and "mostly" is exactly why a person confirms
 * it once before anything is written to the map.
 */

export interface ReportColumn {
  name: string;
  label: string;
  dataType: string | null;
}

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  hint: string;
}

interface PreviewResponse {
  id: string;
  name: string;
  columns: ReportColumn[];
  rowCount: number;
  complete: boolean;
  mapping: Record<string, string>;
  missingRequired: { key: string; label: string }[];
  sampleRows: Record<string, string>[];
  preview: Record<string, unknown>[];
  previewSkipped: { row: number; reason: string }[];
  error?: string;
  remedy?: string;
}

/** The handful of preview fields worth showing per feed, in reading order. */
const PREVIEW_COLUMNS: Record<string, { key: string; label: string }[]> = {
  spaces: [
    { key: 'addressDisplay', label: 'Building' },
    { key: 'floorLabel', label: 'Floor' },
    { key: 'sf', label: 'SF' },
    { key: 'askingRentPsf', label: 'Rent' },
    { key: 'availableFrom', label: 'Available' },
  ],
  occupiers: [
    { key: 'companyName', label: 'Company' },
    { key: 'address', label: 'Building' },
    { key: 'floors', label: 'Floors' },
    { key: 'sf', label: 'SF' },
    { key: 'leaseExpiration', label: 'Lease expires' },
  ],
  clients: [
    { key: 'companyName', label: 'Company' },
    { key: 'address', label: 'Building' },
    { key: 'floors', label: 'Floors' },
    { key: 'sf', label: 'SF' },
    { key: 'leaseExpiration', label: 'Lease expires' },
  ],
};

export default function FieldMapper({
  kind,
  reportId,
  fields,
  onSave,
  onCancel,
  saving,
}: {
  kind: string;
  reportId: string;
  fields: FieldDef[];
  onSave: (mapping: Record<string, string>, reportName: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<{ error: string; remedy?: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  // A ref rather than a dependency: the effect below re-fetches when the
  // mapping changes, and reading it from state there would loop.
  const latest = useRef<Record<string, string> | null>(null);
  latest.current = mapping;

  const load = useCallback(
    async (withMapping: Record<string, string> | null) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ kind });
        if (withMapping) params.set('mapping', JSON.stringify(withMapping));
        const res = await fetch(
          `/api/salesforce/reports/${encodeURIComponent(reportId)}?${params}`,
          { cache: 'no-store' },
        );
        const body = (await res.json()) as PreviewResponse;
        if (!res.ok) throw body;
        setData(body);
        if (!withMapping) setMapping(body.mapping);
      } catch (body) {
        setError(
          body && typeof body === 'object' && 'error' in body
            ? (body as { error: string; remedy?: string })
            : { error: 'Could not read the report.' },
        );
      } finally {
        setBusy(false);
      }
    },
    [kind, reportId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  /**
   * Re-preview after the user stops changing the mapping.
   *
   * Debounced because each preview re-runs the report in Salesforce, and
   * firing one per keystroke through a dozen dropdowns would be rude to
   * somebody else's API limits.
   */
  useEffect(() => {
    if (!mapping || !data) return;
    const t = setTimeout(() => {
      if (latest.current) void load(latest.current);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(mapping)]);

  if (error) {
    return (
      <div className="rounded border border-danger/30 bg-danger/5 px-4 py-3">
        <p className="text-sm font-medium text-danger">{error.error}</p>
        {error.remedy && <p className="mt-1 text-sm text-muted">{error.remedy}</p>}
        <button
          onClick={onCancel}
          className="mt-3 rounded border border-hairline-strong bg-white px-3 py-1.5 text-sm font-medium text-ink hover:border-midnight"
        >
          Back
        </button>
      </div>
    );
  }

  if (!data || !mapping) {
    return <p className="py-4 text-sm text-muted">Reading the report and its columns…</p>;
  }

  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  const previewCols = PREVIEW_COLUMNS[kind] ?? PREVIEW_COLUMNS.spaces;
  const used = new Set(Object.values(mapping).filter(Boolean));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold text-ink">{data.name}</h4>
        <span className="text-xs text-muted">
          {data.rowCount.toLocaleString()} row{data.rowCount === 1 ? '' : 's'} ·{' '}
          {data.columns.length} column{data.columns.length === 1 ? '' : 's'}
        </span>
        {busy && <span className="text-xs text-muted">Refreshing preview…</span>}
      </div>

      {!data.complete && (
        <p className="rounded border border-goldenrod/40 bg-goldenrod/10 px-3 py-2 text-[13px] leading-relaxed text-ink">
          <strong className="font-semibold">Salesforce stopped at 2,000 rows.</strong> Everything
          it sends will be imported, but a sync will never take spaces off the market from a
          truncated report — the rows it did not send are not gone. Add a filter in Salesforce so
          the report fits inside the limit.
        </p>
      )}

      {/* Mapping ------------------------------------------------------------ */}
      <div className="overflow-hidden rounded border border-hairline">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-alt text-left">
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Our field
              </th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Column in this report
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {fields.map((field) => {
              const value = mapping[field.key] ?? '';
              return (
                <tr key={field.key} className={field.required && !value ? 'bg-danger/5' : ''}>
                  <td className="w-1/2 px-3 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-ink">{field.label}</span>
                      {field.required && (
                        <span className="rounded bg-midnight px-1 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-white">
                          Needed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{field.hint}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      value={value}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field.key]: e.target.value })
                      }
                      className="w-full rounded border border-hairline-strong bg-white px-2 py-1.5 text-sm text-ink focus:border-midnight focus:outline-none"
                    >
                      <option value="">— not mapped —</option>
                      {data.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.label}
                          {used.has(c.name) && c.name !== value ? ' (used above)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview ------------------------------------------------------------ */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h5 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            What the first rows become
          </h5>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs text-info hover:underline"
          >
            {showRaw ? 'Hide the raw report rows' : 'Show the raw report rows'}
          </button>
        </div>

        <div className="overflow-x-auto rounded border border-hairline">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface-alt text-left">
                {previewCols.map((c) => (
                  <th
                    key={c.key}
                    className="whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {data.preview.length === 0 && (
                <tr>
                  <td colSpan={previewCols.length} className="px-3 py-4 text-sm text-muted">
                    No row in this report could be placed on the map with the current mapping.
                  </td>
                </tr>
              )}
              {data.preview.map((row, i) => (
                <tr key={i}>
                  {previewCols.map((c) => {
                    const v = row[c.key];
                    return (
                      <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-ink">
                        {v === null || v === undefined || v === ''
                          ? <span className="text-subtle">—</span>
                          : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.previewSkipped.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-warn">
            <Icon name="warning" size={13} className="mt-0.5 shrink-0" />
            <span>
              {data.previewSkipped.length} of the first {data.sampleRows.length} rows could not be
              placed: {data.previewSkipped[0].reason}
              {data.previewSkipped.length > 1 ? ', and others like it' : ''}. Check the mapping
              above before saving.
            </span>
          </p>
        )}

        {showRaw && (
          <div className="mt-3 overflow-x-auto rounded border border-hairline">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-hairline bg-surface-alt text-left">
                  {data.columns.map((c) => (
                    <th
                      key={c.name}
                      className="whitespace-nowrap px-2 py-1.5 font-semibold text-muted"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.sampleRows.map((row, i) => (
                  <tr key={i}>
                    {data.columns.map((c) => (
                      <td key={c.name} className="whitespace-nowrap px-2 py-1 text-body">
                        {row[c.name] || <span className="text-subtle">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Save --------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <button
          onClick={() => onSave(mapping, data.name)}
          disabled={saving || missing.length > 0}
          className="rounded bg-goldenrod px-4 py-2 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {saving ? 'Saving…' : 'Save this mapping'}
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-hairline-strong bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-midnight"
        >
          Cancel
        </button>
        {missing.length > 0 && (
          <span className="text-xs text-danger">
            Still to map: {missing.map((f) => f.label).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
