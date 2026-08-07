'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MatchedRow } from '@/types';

interface GeoFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    name?: string;
    borough?: string;
    locality?: string;
    region?: string;
    addendum?: { pad?: { bin?: string; bbl?: string } };
  };
}

export interface ResolvedMatch {
  buildingId: string;
  bin: string | null;
  bbl: string | null;
  lon: number | null;
  lat: number | null;
  resolvedAddress: string;
}

interface MatchPickerProps {
  row: MatchedRow;
  onResolved: (rowNumber: number, match: ResolvedMatch) => void;
}

const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2/search';

/**
 * Geosearch happily returns Staten Island and Brooklyn hits for a Manhattan
 * query. A broker must never be offered one of those.
 */
export function isManhattan(f: GeoFeature): boolean {
  const p = f.properties ?? {};
  const borough = (p.borough ?? '').toLowerCase();
  const locality = (p.locality ?? '').toLowerCase();
  if (borough.includes('manhattan') || borough.includes('new york')) return true;
  if (locality.includes('manhattan') || locality.includes('new york')) return true;
  if (borough || locality) return false;
  return /,\s*(new york|manhattan),\s*ny/i.test(p.label ?? '');
}

function candidateKey(f: GeoFeature, i: number) {
  return `${f.properties?.addendum?.pad?.bin ?? 'nobin'}-${f.properties?.label ?? i}-${i}`;
}

/** Resolves one address to a real NYC building, permanently. */
export default function MatchPicker({ row, onResolved }: MatchPickerProps) {
  const [query, setQuery] = useState(row.addressDisplay || row.addressRaw);
  const [results, setResults] = useState<GeoFeature[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(row.addressDisplay || row.addressRaw);
    setResults(null);
    setError(null);
  }, [row.rowNumber, row.addressDisplay, row.addressRaw]);

  const search = useCallback(async () => {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setError(null);
    try {
      const url = `${GEOSEARCH}?text=${encodeURIComponent(`${text}, Manhattan, NY`)}&size=6`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`NYC Geosearch returned HTTP ${res.status}`);
      const body = (await res.json()) as { features?: GeoFeature[] };
      setResults((body.features ?? []).filter(isManhattan));
    } catch (err) {
      setError((err as Error).message || 'Could not reach NYC Geosearch.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const choose = useCallback(
    async (f: GeoFeature, key: string) => {
      const p = f.properties ?? {};
      const coords = f.geometry?.coordinates;
      setSaving(key);
      setError(null);
      try {
        const res = await fetch('/api/import/alias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawAddress: row.addressRaw,
            addressDisplay: p.label ?? row.addressDisplay,
            buildingName: row.buildingName,
            bin: p.addendum?.pad?.bin ?? null,
            bbl: p.addendum?.pad?.bbl ?? null,
            lon: coords?.[0] ?? null,
            lat: coords?.[1] ?? null,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          buildingId?: string;
          error?: string;
        };
        if (!res.ok || !body.buildingId) {
          throw new Error(body.error ?? `Could not save the match (HTTP ${res.status}).`);
        }
        onResolved(row.rowNumber, {
          buildingId: body.buildingId,
          bin: p.addendum?.pad?.bin ?? null,
          bbl: p.addendum?.pad?.bbl ?? null,
          lon: coords?.[0] ?? null,
          lat: coords?.[1] ?? null,
          resolvedAddress: p.label ?? row.addressDisplay ?? row.addressRaw,
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSaving(null);
      }
    },
    [onResolved, row],
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Search a Manhattan address…"
          className="flex-1 rounded border border-hairline-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-goldenrod focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching}
          className="shrink-0 rounded bg-midnight px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-midnight-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && (
        <p className="rounded border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {results !== null && results.length === 0 && !searching && (
        <p className="text-sm text-muted">
          No Manhattan buildings matched. Try the street address without the building name.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="divide-y divide-hairline overflow-hidden rounded border border-hairline bg-white shadow-card">
          {results.map((f, i) => {
            const key = candidateKey(f, i);
            const bin = f.properties?.addendum?.pad?.bin;
            const chosen = saving === key;
            return (
              <li
                key={key}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors ${
                  chosen ? 'bg-ok-surface' : 'bg-white hover:bg-goldenrod-50'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    {f.properties?.label ?? f.properties?.name ?? 'Unnamed result'}
                  </div>
                  <div className="tabular text-xs text-muted">
                    {bin ? `BIN ${bin}` : 'No BIN on record'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void choose(f, key)}
                  disabled={saving !== null}
                  className={`shrink-0 rounded px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                    chosen
                      ? 'bg-ok text-white'
                      : 'bg-goldenrod text-midnight hover:bg-goldenrod-400 disabled:opacity-50'
                  }`}
                >
                  {chosen ? 'Saving…' : 'Use this building'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
