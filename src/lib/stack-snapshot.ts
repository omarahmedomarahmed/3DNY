import type { BuildingWithSpaces, Landlord, Space } from '@/types';

/**
 * Stack Snapshot — one building, captured as a shareable image.
 *
 * The deliverable is a single PNG a broker can drop into an email or a deck:
 * the tower as it appears on the map with its available floors lit, beside a
 * panel listing every one of those floors and what is known about the landlord.
 *
 * Composed on a canvas rather than assembled from DOM. Two reasons: the map is
 * already two stacked WebGL canvases and drawing them into a third is the only
 * way to get one flat image, and a canvas has no fonts to load, no layout to
 * settle and nothing to go wrong between "click" and "file saved".
 *
 * The WebGL canvases must be read in the same frame they were drawn, or the
 * drawing buffer is cleared and the capture comes back blank. That constraint
 * shapes the whole capture path — see `captureMapImage`.
 */

const PANEL_W = 560;
const PAD = 40;
const GUTTER = 36;

const INK = '#001E5A';
const BODY = '#31405C';
const MUTED = '#6B7A96';
const GOLD = '#FFB600';
const HAIRLINE = '#E1E6EF';
const WHITE = '#FFFFFF';

export interface SnapshotInput {
  building: BuildingWithSpaces;
  landlord: Landlord | null;
  /** The map, already framed on the building, as a bitmap. */
  mapImage: HTMLCanvasElement;
  /** Marked on the sheet so nobody quotes a stale snapshot. */
  capturedAt: Date;
  /** True when the picture behind the stack is Google photogrammetry. */
  photoreal: boolean;
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Withheld';
  return `$${Math.round(n)}`;
}

function sf(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${Math.round(n).toLocaleString('en-US')} SF`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Floors read top-down, the way a stacking plan is drawn. */
export function sortForStack(spaces: Space[]): Space[] {
  return [...spaces]
    .filter((s) => s.is_active)
    .sort((a, b) => (b.floor_number ?? 0) - (a.floor_number ?? 0));
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(`${last}…`).width > maxWidth) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 2))}…`;
    }
  }
  return lines;
}

/**
 * Draws the sheet. Returns the finished canvas so the caller decides whether to
 * download it, open it, or attach it somewhere.
 */
export function composeSnapshot(input: SnapshotInput): HTMLCanvasElement {
  const { building, landlord, mapImage, capturedAt, photoreal } = input;
  const spaces = sortForStack(building.spaces);

  const mapW = mapImage.width;
  const mapH = mapImage.height;
  const width = mapW + PANEL_W;
  const height = Math.max(mapH, 900);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, width, height);

  // --- The building itself, top-aligned and never stretched.
  ctx.drawImage(mapImage, 0, 0, mapW, mapH);
  if (mapH < height) {
    ctx.fillStyle = '#F4F6FA';
    ctx.fillRect(0, mapH, mapW, height - mapH);
  }

  // A rule between picture and panel, so the two never bleed together.
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(mapW, 0, 1, height);

  const x = mapW + PAD;
  const w = PANEL_W - PAD * 2;
  let y = PAD + 8;

  // --- Header.
  ctx.fillStyle = GOLD;
  ctx.fillRect(x, y, 46, 4);
  y += 26;

  ctx.fillStyle = MUTED;
  ctx.font = '600 12px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  ctx.fillText('STACK SNAPSHOT', x, y);
  y += 30;

  ctx.fillStyle = INK;
  ctx.font = '700 30px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  for (const line of wrap(ctx, building.address_display, w, 2)) {
    ctx.fillText(line, x, y);
    y += 34;
  }

  if (building.building_name) {
    ctx.fillStyle = BODY;
    ctx.font = '500 16px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    ctx.fillText(building.building_name, x, y);
    y += 24;
  }

  ctx.fillStyle = MUTED;
  ctx.font = '400 13px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  const facts = [
    building.class ? `Class ${building.class}` : null,
    building.num_floors ? `${building.num_floors} floors` : null,
    building.year_built ? `Built ${building.year_built}` : null,
    building.submarket_cluster,
  ].filter(Boolean);
  ctx.fillText(facts.join('  ·  '), x, y);
  y += 28;

  // --- Availability summary.
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(x, y, w, 1);
  y += 24;

  ctx.fillStyle = INK;
  ctx.font = '700 15px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  const count = spaces.length === 1 ? '1 space available' : `${spaces.length} spaces available`;
  ctx.fillText(count, x, y);

  ctx.fillStyle = BODY;
  ctx.font = '400 14px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  const total = sf(building.totalAvailableSf);
  ctx.fillText(total, x + w - ctx.measureText(total).width, y);
  y += 26;

  // --- The stack, top floor first.
  const ROW = 62;
  const maxRows = Math.max(0, Math.floor((height - y - 250) / ROW));
  const shown = spaces.slice(0, maxRows);

  for (const space of shown) {
    // A Goldenrod tick tying each row back to its band on the tower.
    ctx.fillStyle = space.floor_portion === 'partial' ? '#FFD980' : GOLD;
    ctx.fillRect(x, y - 12, 4, 34);

    ctx.fillStyle = INK;
    ctx.font = '700 16px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    ctx.fillText(space.floor_label, x + 14, y);

    const rent = space.asking_rent_withheld ? 'Withheld' : `${money(space.asking_rent_psf)} /SF`;
    ctx.fillStyle = space.asking_rent_withheld ? MUTED : INK;
    ctx.font = space.asking_rent_withheld
      ? '400 15px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif'
      : '700 16px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    ctx.fillText(rent, x + w - ctx.measureText(rent).width, y);
    y += 20;

    ctx.fillStyle = MUTED;
    ctx.font = '400 13px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    const detail = [
      sf(space.sf),
      space.lease_type === 'sublet' ? 'Sublet' : 'Direct',
      `Avail ${shortDate(space.available_from)}`,
      space.term_expires ? `Exp ${shortDate(space.term_expires)}` : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
    ctx.fillText(detail, x + 14, y);
    y += 16;

    if (space.leasing_company) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 12px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
      ctx.fillText(space.leasing_company, x + 14, y);
    }
    y += ROW - 36;
  }

  if (spaces.length > shown.length) {
    ctx.fillStyle = MUTED;
    ctx.font = 'italic 400 13px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    ctx.fillText(`+ ${spaces.length - shown.length} more in the app`, x, y);
    y += 22;
  }

  // --- Landlord.
  y += 8;
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(x, y, w, 1);
  y += 24;

  ctx.fillStyle = MUTED;
  ctx.font = '600 12px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  ctx.fillText('LANDLORD', x, y);
  y += 22;

  ctx.fillStyle = INK;
  ctx.font = '700 17px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  ctx.fillText(landlord?.name ?? building.landlord_name ?? 'Not recorded', x, y);
  y += 22;

  if (landlord) {
    const stats = [
      landlord.portfolio_sf ? `${sf(landlord.portfolio_sf)} portfolio` : null,
      landlord.buildings_owned ? `${landlord.buildings_owned} buildings` : null,
      landlord.avg_asking_rent ? `${money(landlord.avg_asking_rent)} avg asking` : null,
    ].filter(Boolean);
    if (stats.length) {
      ctx.fillStyle = BODY;
      ctx.font = '400 13px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
      ctx.fillText(stats.join('  ·  '), x, y);
      y += 20;
    }

    if (landlord.insights_md) {
      ctx.fillStyle = BODY;
      ctx.font = '400 13px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
      // Markdown emphasis would read as literal asterisks on a canvas.
      const plain = landlord.insights_md.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
      for (const line of wrap(ctx, plain, w, 5)) {
        ctx.fillText(line, x, y);
        y += 18;
      }
      y += 4;
    }

    if (landlord.amenities.length) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 12px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
      for (const line of wrap(ctx, landlord.amenities.join('  ·  '), w, 2)) {
        ctx.fillText(line, x, y);
        y += 16;
      }
    }

    if (landlord.needs_review) {
      y += 6;
      ctx.fillStyle = '#8A6100';
      ctx.font = 'italic 400 12px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
      ctx.fillText('Landlord name is from city records and unconfirmed.', x, y);
      y += 16;
    }
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = 'italic 400 13px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    ctx.fillText('No landlord profile written yet.', x, y);
    y += 18;
  }

  // --- Footer. Provenance, because a snapshot outlives the data in it.
  const footY = height - PAD;
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(x, footY - 34, w, 1);

  ctx.fillStyle = MUTED;
  ctx.font = '400 11px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
  const stamp = capturedAt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  ctx.fillText(`Cresa Spaces · ${stamp}`, x, footY - 14);

  const source = photoreal
    ? 'Imagery © Google · floors from your availability sheet'
    : 'Massing from NYC Open Data · floors from your availability sheet';
  ctx.fillText(source, x, footY);

  return canvas;
}

/** Turns the composed sheet into a download, named after the building. */
export function downloadSnapshot(canvas: HTMLCanvasElement, building: BuildingWithSpaces) {
  const slug = building.address_display
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'building'}-stack.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick, so the click has already consumed it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, 'image/png');
}

export { GUTTER };
