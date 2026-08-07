'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { SpaceImage } from '@/types';

const SETUP_MESSAGE = "Photo storage isn't set up yet — see SETUP.md step 4";

export async function fetchSpaceImages(spaceId: string): Promise<SpaceImage[]> {
  const res = await fetch(`/api/spaces/${spaceId}/images`, { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? (body as SpaceImage[]) : [];
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; needsSetup?: boolean };
  if (res.status === 503 && body.needsSetup) return SETUP_MESSAGE;
  return body.error ?? `Request failed (${res.status})`;
}

export default function PhotoGallery({ spaceId }: { spaceId: string }) {
  const [images, setImages] = useState<SpaceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<SpaceImage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setImages(await fetchSpaceImages(spaceId));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    let cancelled = false;
    setLightbox(null);
    setError(null);
    (async () => {
      const next = await fetchSpaceImages(spaceId);
      if (!cancelled) {
        setImages(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: form });
      if (!uploadRes.ok) throw new Error(await readError(uploadRes));
      const { url } = (await uploadRes.json()) as { url?: string };
      if (!url) throw new Error('Upload succeeded but returned no URL.');

      const attachRes = await fetch(`/api/spaces/${spaceId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blob_url: url, caption: file.name }),
      });
      if (!attachRes.ok) throw new Error(await readError(attachRes));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(image: SpaceImage) {
    if (!window.confirm('Delete this photo?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/images?imageId=${encodeURIComponent(image.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(await readError(res));
      setImages((prev) => prev.filter((i) => i.id !== image.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Photos {images.length > 0 && <span className="text-subtle">({images.length})</span>}
        </h4>
        {busy && <span className="text-[11px] font-medium text-muted">Uploading…</span>}
      </div>

      {error && (
        <p className="rounded border-l-2 border-warmorange bg-warn-surface px-3 py-2 text-xs font-medium text-warmorange">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted">Loading photos…</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <li
              key={image.id}
              className="group relative overflow-hidden rounded-card border border-hairline bg-white shadow-card"
            >
              <button
                type="button"
                onClick={() => setLightbox(image)}
                className="block h-full w-full"
                title={image.caption ?? 'Open photo'}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.blob_url}
                  alt={image.caption ?? 'Space photo'}
                  className="h-28 w-full bg-surface-sunken object-cover"
                  loading="lazy"
                />
              </button>
              {image.caption && (
                <p
                  className="truncate border-t border-hairline bg-white px-2 py-1 text-[10px] text-muted"
                  title={image.caption}
                >
                  {image.caption}
                </p>
              )}
              <button
                type="button"
                onClick={() => void remove(image)}
                disabled={busy}
                aria-label="Delete photo"
                className={clsx(
                  'absolute right-1.5 top-1.5 rounded border border-hairline bg-white/95 px-1.5 py-0.5 text-[11px] font-medium text-muted shadow-card',
                  'opacity-0 transition-opacity hover:text-danger group-hover:opacity-100',
                )}
              >
                ✕
              </button>
            </li>
          ))}

          <li>
            <label
              className={clsx(
                'flex h-full min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-card',
                'border border-dashed border-hairline-strong bg-surface-alt px-3 text-center text-[11px] font-medium text-muted',
                'transition-colors hover:border-midnight hover:text-ink',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              <span aria-hidden className="text-base leading-none text-subtle">
                +
              </span>
              {busy ? 'Uploading…' : images.length === 0 ? 'Add the first photo' : 'Add photo'}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </label>
          </li>
        </ul>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-midnight/70 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <figure
            className="max-h-full max-w-4xl rounded-card bg-white p-3 shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.blob_url}
              alt={lightbox.caption ?? 'Space photo'}
              className="max-h-[80vh] w-auto rounded border border-hairline object-contain"
            />
            <figcaption className="mt-3 flex items-center justify-between gap-4 text-xs text-muted">
              <span className="truncate">{lightbox.caption ?? ''}</span>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="shrink-0 rounded border border-hairline-strong bg-white px-2.5 py-1 font-medium text-body transition-colors hover:border-midnight hover:text-ink"
              >
                Close
              </button>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
