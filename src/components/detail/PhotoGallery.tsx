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
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Photos {images.length > 0 && <span className="text-muted/60">({images.length})</span>}
        </h4>
        <label
          className={clsx(
            'cursor-pointer rounded border border-edge px-2 py-1 text-[11px] text-muted',
            'hover:border-accent/60 hover:text-accent',
            busy && 'pointer-events-none opacity-50',
          )}
        >
          {busy ? 'Uploading…' : 'Upload photo'}
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
      </div>

      {error && (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted">Loading photos…</p>
      ) : images.length === 0 ? (
        <p className="rounded border border-dashed border-edge px-3 py-6 text-center text-xs text-muted">
          No photos yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <li key={image.id} className="group relative overflow-hidden rounded border border-edge">
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
                  className="h-28 w-full bg-ink object-cover"
                  loading="lazy"
                />
              </button>
              {image.caption && (
                <p className="truncate bg-ink/80 px-2 py-1 text-[10px] text-muted" title={image.caption}>
                  {image.caption}
                </p>
              )}
              <button
                type="button"
                onClick={() => void remove(image)}
                disabled={busy}
                aria-label="Delete photo"
                className={clsx(
                  'absolute right-1 top-1 rounded bg-ink/80 px-1.5 py-0.5 text-[11px] text-muted',
                  'opacity-0 transition-opacity hover:text-danger group-hover:opacity-100',
                )}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <figure className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.blob_url}
              alt={lightbox.caption ?? 'Space photo'}
              className="max-h-[80vh] w-auto rounded border border-edge object-contain"
            />
            <figcaption className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>{lightbox.caption ?? ''}</span>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded border border-edge px-2 py-1 hover:text-white"
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
