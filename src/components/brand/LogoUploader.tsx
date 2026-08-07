'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Logo, { DotMotif, invalidateBrandSettings } from '@/components/brand/Logo';
import {
  BRAND_LIMITS,
  DEFAULT_BRAND_SETTINGS,
  type BrandSettings,
} from '@/lib/brand-settings';

/**
 * The logo control for /setup.
 *
 * The whole feature exists because a logo that looks fine on a white card can
 * sit badly in a 64px nav bar — too tall, too low, crowding the divider. So the
 * adjustment happens against a faithful mock of the real header rather than a
 * neutral swatch: what you see here is what ships.
 */

const ACCEPT = 'image/svg+xml,image/png,image/jpeg,image/webp';
const ACCEPTED_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

const BLOB_NOT_READY =
  'Image storage is not switched on yet, so there is nowhere to keep the logo. ' +
  'In Vercel, open Storage and create a Blob store, then redeploy — SETUP.md step 4 ' +
  'walks through it. Everything else on this page works without it.';

export default function LogoUploader({ className = '' }: { className?: string }) {
  const [draft, setDraft] = useState<BrandSettings>(DEFAULT_BRAND_SETTINGS);
  const [saved, setSaved] = useState<BrandSettings>(DEFAULT_BRAND_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load current settings ---------------------------------------------------
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/brand', { cache: 'no-store' });
        const body = (await res.json()) as Partial<BrandSettings>;
        if (!live) return;
        const next = { ...DEFAULT_BRAND_SETTINGS, ...body };
        setDraft(next);
        setSaved(next);
      } catch {
        // Defaults are already in state; nothing to report.
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const set = useCallback(<K extends keyof BrandSettings>(key: K, value: BrandSettings[K]) => {
    setSavingState('idle');
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  // Upload ------------------------------------------------------------------
  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setNotice(null);

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError('That file type is not supported. Use an SVG, PNG, JPG or WEBP.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError('That file is larger than 4 MB. A logo should be well under that.');
        return;
      }

      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const body = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
          needsSetup?: boolean;
        };

        if (res.status === 503 && body.needsSetup) {
          setNotice(BLOB_NOT_READY);
          return;
        }
        if (!res.ok || !body.url) {
          throw new Error(body.error ?? `Upload failed (${res.status}).`);
        }

        setSavingState('idle');
        setDraft((d) => ({ ...d, logoUrl: body.url as string }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  // Save --------------------------------------------------------------------
  async function save() {
    setSavingState('saving');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/brand', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logoUrl: draft.logoUrl,
          logoScale: draft.logoScale,
          logoOffsetX: draft.logoOffsetX,
          logoOffsetY: draft.logoOffsetY,
          logoHeight: draft.logoHeight,
          footerScale: draft.footerScale,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<BrandSettings> & {
        error?: string;
        needsSetup?: boolean;
      };

      if (res.status === 503 && body.needsSetup) {
        setNotice(
          body.error ??
            'The database is not connected yet, so there is nowhere to store the logo settings.',
        );
        setSavingState('idle');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `Could not save (${res.status}).`);

      const next = { ...DEFAULT_BRAND_SETTINGS, ...body };
      setDraft(next);
      setSaved(next);
      invalidateBrandSettings(next);
      setSavingState('saved');
    } catch (err) {
      setError((err as Error).message);
      setSavingState('idle');
    }
  }

  function resetToDefault() {
    setSavingState('idle');
    setNotice(null);
    setError(null);
    setDraft({ ...DEFAULT_BRAND_SETTINGS });
    if (fileRef.current) fileRef.current.value = '';
  }

  const dirty =
    draft.logoUrl !== saved.logoUrl ||
    draft.logoScale !== saved.logoScale ||
    draft.logoOffsetX !== saved.logoOffsetX ||
    draft.logoOffsetY !== saved.logoOffsetY ||
    draft.logoHeight !== saved.logoHeight ||
    draft.footerScale !== saved.footerScale;

  return (
    <section
      className={`rounded-card border border-hairline bg-white p-6 shadow-card ${className}`}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Logo
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        Upload the official Cresa artwork, then nudge it until it sits correctly. The
        previews below are the real navigation bar and footer, so what you see is exactly
        what everyone else will see.
      </p>

      {/* Drop zone ------------------------------------------------------- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-5 flex flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging
            ? 'border-goldenrod bg-goldenrod-50'
            : 'border-hairline-strong bg-surface-sunken'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-subtle"
        >
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <p className="mt-3 text-sm text-body">
          Drag the logo file here, or{' '}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="font-medium text-info underline underline-offset-2"
          >
            choose a file
          </button>
        </p>
        <p className="mt-1 text-xs text-subtle">
          SVG, PNG, JPG or WEBP, up to 4 MB. SVG stays sharp at every size.
        </p>
        {uploading && <p className="mt-3 text-xs text-info">Uploading…</p>}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>

      {notice && (
        <p className="mt-4 rounded border border-warn/30 bg-warn-surface px-4 py-3 text-sm leading-relaxed text-body">
          {notice}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {/* Nav preview ----------------------------------------------------- */}
      <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        In the navigation bar
      </p>
      <div className="mt-3 overflow-hidden rounded-card border border-hairline shadow-card">
        <NavPreview settings={draft} />
      </div>

      {/* Footer preview -------------------------------------------------- */}
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        In the footer
      </p>
      <div className="mt-3 overflow-hidden rounded-card border border-hairline shadow-card">
        <FooterPreview settings={draft} />
      </div>

      {/* Controls -------------------------------------------------------- */}
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Slider
          label="Scale"
          value={draft.logoScale}
          limits={BRAND_LIMITS.logoScale}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set('logoScale', v)}
          disabled={loading}
        />
        <Slider
          label="Height"
          value={draft.logoHeight}
          limits={BRAND_LIMITS.logoHeight}
          format={(v) => `${Math.round(v)} px`}
          onChange={(v) => set('logoHeight', Math.round(v))}
          disabled={loading}
        />
        <Slider
          label="Horizontal offset"
          value={draft.logoOffsetX}
          limits={BRAND_LIMITS.logoOffsetX}
          format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} px`}
          onChange={(v) => set('logoOffsetX', Math.round(v))}
          disabled={loading}
        />
        <Slider
          label="Vertical offset"
          value={draft.logoOffsetY}
          limits={BRAND_LIMITS.logoOffsetY}
          format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} px`}
          onChange={(v) => set('logoOffsetY', Math.round(v))}
          disabled={loading}
        />
        <Slider
          label="Footer scale"
          value={draft.footerScale}
          limits={BRAND_LIMITS.footerScale}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set('footerScale', v)}
          disabled={loading}
          hint="Applied on top of the scale above, for the smaller footer lockup."
        />
      </div>

      {!draft.logoUrl && (
        <p className="mt-5 text-xs leading-relaxed text-subtle">
          No custom logo yet — the previews show the built-in mark, which is already
          aligned, so the position controls only take effect once you upload artwork.
        </p>
      )}

      {/* Actions --------------------------------------------------------- */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={savingState === 'saving' || loading || !dirty}
          className="rounded bg-goldenrod px-5 py-2.5 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {savingState === 'saving' ? 'Saving…' : 'Save logo'}
        </button>
        <button
          type="button"
          onClick={resetToDefault}
          className="rounded border border-hairline-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-midnight hover:bg-midnight-50"
        >
          Reset to default
        </button>
        {savingState === 'saved' && !dirty && (
          <span className="text-sm text-ok">Saved — it is live across the app.</span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

const NAV = ['Map', 'Import', 'Landlords', 'Setup'];

/** A faithful mock of AppHeader — same height, divider, links and button. */
function NavPreview({ settings }: { settings: BrandSettings }) {
  return (
    <div className="bg-surface-alt p-4">
      {/* `overflow-hidden` matters: this mock is narrower than a real window,
          so the right-hand controls have to clip rather than wrap. */}
      <header className="flex h-16 shrink-0 items-center gap-6 overflow-hidden border-b border-hairline bg-white px-5">
        <Logo href={null} product="Spaces" settings={settings} />

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {NAV.map((label, i) => (
            <span
              key={label}
              className={`relative rounded px-3 py-2 text-sm font-medium ${
                i === 3 ? 'text-ink' : 'text-muted'
              }`}
            >
              {label}
              {i === 3 && (
                <span className="absolute inset-x-3 -bottom-[13px] h-[3px] bg-goldenrod" />
              )}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="whitespace-nowrap rounded bg-midnight px-4 py-2 text-sm font-medium text-white">
            Upload sheet
          </span>
        </div>
      </header>
      <div className="h-8 bg-surface-alt" />
    </div>
  );
}

/** The footer lockup, at its smaller height and with the footer scale applied. */
function FooterPreview({ settings }: { settings: BrandSettings }) {
  return (
    <div className="bg-surface-alt p-4">
      <div className="border-t border-hairline bg-white">
        <div className="flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center">
          <Logo href={null} height={22} variant="footer" settings={settings} />
          <p className="text-xs leading-relaxed text-subtle sm:ml-auto sm:max-w-xs sm:text-right">
            Internal tenant-advisory tool. Building geometry from NYC Open Data.
          </p>
        </div>
        <div className="flex items-center gap-4 border-t border-hairline px-6 py-3">
          <DotMotif size={18} />
          <span className="text-[11px] text-subtle">Availability from your weekly sheet.</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

function Slider({
  label,
  value,
  limits,
  format,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  limits: { min: number; max: number; step: number };
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-body">{label}</span>
        <span className="tabular text-xs text-muted">{format(value)}</span>
      </span>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-goldenrod disabled:opacity-40"
      />
      {hint && <span className="mt-1 block text-xs leading-relaxed text-subtle">{hint}</span>}
    </label>
  );
}
