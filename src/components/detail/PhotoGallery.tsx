'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { SpaceImage } from '@/types';
import Icon from '@/components/ui/Icon';

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

/** Progress for a run of uploads, so the user sees "Uploading 2 of 5…". */
interface UploadProgress {
  done: number;
  total: number;
  name: string;
}

const ACTION_BUTTON =
  'inline-flex items-center gap-1.5 rounded border border-hairline-strong bg-white px-2 py-1 ' +
  'text-sm font-medium text-body transition-colors hover:border-midnight hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const ICON_BUTTON =
  'inline-flex items-center justify-center rounded border border-hairline-strong bg-white/95 p-1.5 ' +
  'text-muted shadow-card transition-colors hover:border-midnight hover:text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

export default function PhotoGallery({ spaceId }: { spaceId: string }) {
  const [images, setImages] = useState<SpaceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState<{ id: string; text: string } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setImages(await fetchSpaceImages(spaceId));
  }, [spaceId]);

  useEffect(() => {
    let cancelled = false;
    setLightboxIndex(null);
    setConfirmingDelete(null);
    setCaptionDraft(null);
    setError(null);
    setLoading(true);
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

  // -------------------------------------------------------------------------
  // Persisting order and captions.
  //
  // The images route exposes GET/POST/DELETE. We ask for a PATCH first, so the
  // day the route grows one this becomes a single cheap request; until then we
  // fall back to rewriting the list — every row is re-created in the desired
  // order *before* the old rows are deleted, so a failure halfway leaves
  // duplicates rather than losing a photo.
  // -------------------------------------------------------------------------
  const persistList = useCallback(
    async (next: SpaceImage[]) => {
      setBusy(true);
      setError(null);
      const previous = images;
      setImages(next); // optimistic: the grid reorders instantly
      try {
        const patchRes = await fetch(`/api/spaces/${spaceId}/images`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: next.map((img, i) => ({ id: img.id, caption: img.caption, sort_order: i })),
          }),
        }).catch(() => null);

        if (patchRes?.ok) {
          await reload();
          return;
        }

        for (const img of next) {
          const res = await fetch(`/api/spaces/${spaceId}/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blob_url: img.blob_url, caption: img.caption }),
          });
          if (!res.ok) throw new Error(await readError(res));
        }
        for (const img of previous) {
          const res = await fetch(
            `/api/spaces/${spaceId}/images?imageId=${encodeURIComponent(img.id)}`,
            { method: 'DELETE' },
          );
          if (!res.ok) throw new Error(await readError(res));
        }
        await reload();
      } catch (err) {
        setError((err as Error).message);
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [images, reload, spaceId],
  );

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------
  const uploadFiles = useCallback(
    async (files: File[]) => {
      const picked = files.filter((f) => f.type.startsWith('image/'));
      if (picked.length === 0) {
        if (files.length > 0) setError('Those files are not images.');
        return;
      }
      setBusy(true);
      setError(null);
      let uploaded = 0;
      try {
        for (let i = 0; i < picked.length; i++) {
          const file = picked[i];
          setProgress({ done: i, total: picked.length, name: file.name });

          const form = new FormData();
          form.append('file', file);
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: form });
          if (!uploadRes.ok) throw new Error(await readError(uploadRes));
          const { url } = (await uploadRes.json()) as { url?: string };
          if (!url) throw new Error('Upload succeeded but returned no URL.');

          const attachRes = await fetch(`/api/spaces/${spaceId}/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blob_url: url, caption: stripExtension(file.name) }),
          });
          if (!attachRes.ok) throw new Error(await readError(attachRes));
          uploaded++;
        }
      } catch (err) {
        const message = (err as Error).message;
        setError(
          uploaded > 0
            ? `${message} — ${uploaded} of ${picked.length} photos were saved.`
            : message,
        );
      } finally {
        setProgress(null);
        setBusy(false);
        if (fileInput.current) fileInput.current.value = '';
        await reload();
      }
    },
    [reload, spaceId],
  );

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  async function remove(image: SpaceImage) {
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
      setConfirmingDelete(null);
      setBusy(false);
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length || from === to) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistList(next);
  }

  function saveCaption() {
    if (!captionDraft) return;
    const text = captionDraft.text.trim();
    const target = images.find((i) => i.id === captionDraft.id);
    setCaptionDraft(null);
    if (!target || (target.caption ?? '') === text) return;
    void persistList(
      images.map((i) => (i.id === captionDraft.id ? { ...i, caption: text || null } : i)),
    );
  }

  // -------------------------------------------------------------------------
  // Lightbox keyboard control
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxIndex(null);
      } else if (e.key === 'ArrowRight') {
        setLightboxIndex((i) => (i === null ? null : (i + 1) % images.length));
      } else if (e.key === 'ArrowLeft') {
        setLightboxIndex((i) => (i === null ? null : (i - 1 + images.length) % images.length));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, images.length]);

  const lightbox = lightboxIndex === null ? null : (images[lightboxIndex] ?? null);
  const busyLabel = useMemo(() => {
    if (progress) return `Uploading ${progress.done + 1} of ${progress.total}…`;
    if (busy) return 'Saving…';
    return null;
  }, [busy, progress]);

  // -------------------------------------------------------------------------
  // Drop handling. Only file drags light the zone up; thumbnail reordering uses
  // its own payload and is handled per-thumbnail.
  // -------------------------------------------------------------------------
  function isFileDrag(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types ?? []).includes('Files');
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          <Icon name="camera" size={15} />
          Photos
          {images.length > 0 && <span className="tabular text-subtle">({images.length})</span>}
        </h4>
        <div className="flex items-center gap-3">
          {busyLabel && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <Icon name="upload" size={14} />
              {busyLabel}
            </span>
          )}
          {images.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className={ACTION_BUTTON}
            >
              <Icon name="plus" size={14} />
              Add photos
            </button>
          )}
        </div>
      </div>

      {progress && (
        <div className="space-y-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-goldenrod transition-all"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
          <p className="truncate text-[11px] font-medium text-muted">{progress.name}</p>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded border-l-2 border-warmorange bg-warn-surface px-3 py-2 text-sm font-medium text-warmorange">
          <Icon name="warning" size={15} className="mt-0.5" />
          <span>{error}</span>
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void uploadFiles(files);
        }}
      />

      {loading ? (
        <p className="text-sm font-medium text-muted">Loading photos…</p>
      ) : (
        <div
          onDragOver={(e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDropActive(false);
          }}
          onDrop={(e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            setDropActive(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) void uploadFiles(files);
          }}
          className={clsx(
            'rounded-card transition-colors',
            dropActive && 'bg-goldenrod-50 ring-2 ring-goldenrod ring-offset-2',
          )}
        >
          {images.length === 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className={clsx(
                'flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed px-6 py-10 text-center transition-colors',
                dropActive
                  ? 'border-goldenrod bg-goldenrod-50'
                  : 'border-hairline-strong bg-surface-alt hover:border-midnight',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              <Icon name="camera" size={28} className="text-subtle" />
              <span className="text-sm font-semibold text-ink">
                Drop photos here, or click to choose files
              </span>
              <span className="max-w-sm text-sm font-medium leading-5 text-muted">
                Photos show on the space card, in compare, and in the client-facing view. The first
                photo is the one clients see first.
              </span>
            </button>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((image, index) => {
                const isCover = index === 0;
                const confirming = confirmingDelete === image.id;
                const editingCaption = captionDraft?.id === image.id;
                return (
                  <li
                    key={image.id}
                    draggable={!busy}
                    onDragStart={(e) => {
                      dragIndex.current = index;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragOver={(e) => {
                      if (dragIndex.current === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverIndex(index);
                    }}
                    onDragLeave={() => setDragOverIndex((i) => (i === index ? null : i))}
                    onDrop={(e) => {
                      if (dragIndex.current === null) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const from = dragIndex.current;
                      dragIndex.current = null;
                      setDragOverIndex(null);
                      move(from, index);
                    }}
                    onDragEnd={() => {
                      dragIndex.current = null;
                      setDragOverIndex(null);
                    }}
                    className={clsx(
                      'group relative overflow-hidden rounded-card border bg-white shadow-card transition-shadow',
                      dragOverIndex === index
                        ? 'border-goldenrod ring-2 ring-goldenrod'
                        : 'border-hairline',
                      isCover && dragOverIndex !== index && 'border-goldenrod',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      className="block w-full"
                      title={image.caption ?? 'Open photo'}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.blob_url}
                        alt={image.caption ?? 'Space photo'}
                        className="h-28 w-full bg-surface-sunken object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    </button>

                    {isCover && (
                      <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-goldenrod px-2 py-0.5 text-[11px] font-semibold leading-4 text-midnight shadow-card">
                        <Icon name="star" size={11} />
                        Cover
                      </span>
                    )}

                    <span
                      aria-hidden
                      className="absolute right-1.5 top-1.5 hidden rounded bg-white/85 p-1 text-subtle group-hover:block"
                      title="Drag to reorder"
                    >
                      <Icon name="drag" size={13} />
                    </span>

                    {/* Caption */}
                    <div className="border-t border-hairline bg-white px-2 py-1.5">
                      {editingCaption ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={captionDraft.text}
                            onChange={(e) =>
                              setCaptionDraft({ id: image.id, text: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveCaption();
                              if (e.key === 'Escape') setCaptionDraft(null);
                            }}
                            placeholder="Caption"
                            className="w-full min-w-0 rounded border border-hairline-strong px-1.5 py-1 text-sm font-medium text-ink placeholder:text-subtle"
                          />
                          <button
                            type="button"
                            onClick={saveCaption}
                            title="Save caption"
                            className="rounded p-1 text-ok transition-colors hover:bg-ok-surface"
                          >
                            <Icon name="check" size={14} title="Save caption" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCaptionDraft(null)}
                            title="Cancel"
                            className="rounded p-1 text-muted transition-colors hover:text-ink"
                          >
                            <Icon name="close" size={14} title="Cancel" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setCaptionDraft({ id: image.id, text: image.caption ?? '' })}
                          className="flex w-full items-center gap-1.5 text-left"
                          title="Edit caption"
                        >
                          <span
                            className={clsx(
                              'min-w-0 flex-1 truncate text-sm font-medium',
                              image.caption ? 'text-body' : 'text-subtle',
                            )}
                          >
                            {image.caption || 'Add a caption'}
                          </span>
                          <Icon
                            name="edit"
                            size={13}
                            className="text-subtle opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </button>
                      )}
                    </div>

                    {/* Hover controls */}
                    <div
                      className={clsx(
                        'absolute inset-x-0 bottom-[38px] flex items-center justify-between gap-1 px-1.5 pb-1.5',
                        'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => move(index, index - 1)}
                          title="Move left"
                          className={ICON_BUTTON}
                        >
                          <Icon name="chevron-left" size={14} title="Move left" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === images.length - 1}
                          onClick={() => move(index, index + 1)}
                          title="Move right"
                          className={ICON_BUTTON}
                        >
                          <Icon name="chevron-right" size={14} title="Move right" />
                        </button>
                        {!isCover && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => move(index, 0)}
                            title="Set as cover photo"
                            className={ICON_BUTTON}
                          >
                            <Icon name="star" size={14} title="Set as cover photo" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingDelete(image.id)}
                        title="Delete photo"
                        className={clsx(ICON_BUTTON, 'hover:border-danger hover:text-danger')}
                      >
                        <Icon name="trash" size={14} title="Delete photo" />
                      </button>
                    </div>

                    {confirming && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/95 px-2 text-center">
                        <p className="text-sm font-semibold leading-4 text-ink">Delete this photo?</p>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void remove(image)}
                            className="inline-flex items-center gap-1 rounded bg-danger px-2.5 py-1 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            <Icon name="trash" size={13} />
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(null)}
                            className={ACTION_BUTTON}
                          >
                            Keep
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}

              <li>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                  className={clsx(
                    'flex h-full min-h-[7.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-card',
                    'border border-dashed border-hairline-strong bg-surface-alt px-3 text-center',
                    'text-sm font-medium text-muted transition-colors hover:border-midnight hover:text-ink',
                    busy && 'pointer-events-none opacity-50',
                  )}
                >
                  <Icon name="plus" size={20} className="text-subtle" />
                  Add photos
                  <span className="text-[11px] font-medium text-subtle">or drop them here</span>
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {lightbox && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-midnight/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            type="button"
            aria-label="Previous photo"
            disabled={images.length < 2}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex((i) => (i === null ? null : (i - 1 + images.length) % images.length));
            }}
            className="absolute left-4 rounded-full bg-white/90 p-3 text-midnight shadow-float transition-colors hover:bg-white disabled:opacity-30"
          >
            <Icon name="chevron-left" size={22} title="Previous photo" />
          </button>

          <figure
            className="max-h-full max-w-4xl rounded-card bg-white p-3 shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.blob_url}
              alt={lightbox.caption ?? 'Space photo'}
              className="max-h-[78vh] w-auto rounded border border-hairline object-contain"
            />
            <figcaption className="mt-3 flex items-center justify-between gap-4">
              <span className="truncate text-sm font-medium text-body">
                {lightbox.caption ?? ''}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular text-sm font-semibold text-muted">
                  {lightboxIndex + 1} of {images.length}
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxIndex(null)}
                  className={ACTION_BUTTON}
                >
                  <Icon name="close" size={14} />
                  Close
                </button>
              </div>
            </figcaption>
          </figure>

          <button
            type="button"
            aria-label="Next photo"
            disabled={images.length < 2}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex((i) => (i === null ? null : (i + 1) % images.length));
            }}
            className="absolute right-4 rounded-full bg-white/90 p-3 text-midnight shadow-float transition-colors hover:bg-white disabled:opacity-30"
          >
            <Icon name="chevron-right" size={22} title="Next photo" />
          </button>
        </div>
      )}
    </section>
  );
}

/** "Suite 1401 photo.jpg" reads better as a caption without the extension. */
function stripExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]{2,5}$/i, '');
}
