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

/**
 * The sheet is composed at this multiple of its layout size.
 *
 * A snapshot goes into an email or a deck, where it is viewed at least at
 * 100% and often zoomed. Composed 1:1 it was a screenshot: the type came out
 * as soft as the map behind it, which is most of why the result looked cheap.
 * Drawing at 2x makes every rule, label and number resolution-independent,
 * and gives the map picture room to be presented rather than downscaled.
 */
export const DRAW_SCALE = 2;

/**
 * Shortest the sheet gets, in layout units.
 *
 * Low enough that a building with a single availability produces a compact
 * sheet rather than one with a void under the landlord block, and high enough
 * that the picture beside the panel is still a picture — the two are the same
 * height, so this is also the smallest the building is ever shown at.
 */
const MIN_SHEET_H = 520;


/** Height of one floor row in the stack. */
const ROW = 62;

/**
 * Most floors a sheet will list.
 *
 * Beyond this the picture beside it would be enormous — the two are the same
 * height — and the point of a snapshot is a glance, not a rent roll. The
 * remainder is called out as "+ N more in the app".
 */
const MAX_STACK_ROWS = 16;

/** Room the footer needs beneath the panel's last line. */
const FOOTER_H = 74;

/** The sheet never grows past this, however much a building has in it. */
const MAX_SHEET_H = 1600;

/**
 * Pixel size the map capture is delivered at.
 *
 * The sheet's height varies with its content, so this is sized for the common
 * case rather than derived from it: enough that a typical sheet draws the
 * picture at roughly 1:1, and cropped-to-cover either way. It is deliberately
 * larger than a small window renders, because handing the composer fewer
 * pixels than it draws into is exactly what made snapshots look soft.
 */
export const SNAPSHOT_SIDE = 1800;

/**
 * Draws an image filling a rectangle, cropping the overflow rather than
 * distorting — the `object-fit: cover` rule, which canvas has no shorthand
 * for. Centred, so a framed building stays framed.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (image.width === 0 || image.height === 0 || dw <= 0 || dh <= 0) return;
  const scale = Math.max(dw / image.width, dh / image.height);
  const sw = dw / scale;
  const sh = dh / scale;
  ctx.drawImage(
    image,
    (image.width - sw) / 2,
    (image.height - sh) / 2,
    sw,
    sh,
    dx,
    dy,
    dw,
    dh,
  );
}

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
/**
 * Draws the right-hand panel and returns the y it finished at.
 *
 * Split out so it can be run twice: once against a throwaway context purely to
 * measure how tall this building's content actually is, then again for real
 * into a sheet cut to that height. Nothing here reads the sheet's dimensions,
 * which is what makes the measuring pass honest.
 */
function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  input: SnapshotInput,
  spaces: Space[],
): number {
  const { building, landlord } = input;
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
  //
  // The row count no longer depends on how tall the sheet is — the sheet is
  // cut to fit the rows. It is capped only so a building with forty
  // availabilities does not produce a sheet nobody can read at a glance.
  const shown = spaces.slice(0, MAX_STACK_ROWS);

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


  return y;
}

export function composeSnapshot(input: SnapshotInput): HTMLCanvasElement {
  const { building, landlord, mapImage, capturedAt, photoreal } = input;
  const spaces = sortForStack(building.spaces);

  // The sheet is cut to fit what is actually in it.
  //
  // Two separate causes of dead space, both fixed here. The layout used to
  // take its dimensions from whatever the capture happened to be, so any
  // capture shorter than the panel needed left a grey band under the picture.
  // And the height was then fixed regardless of content, so a building with
  // one availability produced a sheet two-thirds empty below the landlord
  // block — which is the white space you actually notice.
  //
  // So the panel is drawn once against a throwaway context purely to find out
  // how tall it is, and the sheet is cut to that. A one-space building gets a
  // compact sheet; a twelve-space building gets a taller one; neither has a
  // void in it.
  const measure = document.createElement('canvas').getContext('2d');
  const panelBottom = measure ? drawPanel(measure, 0, PANEL_W - PAD * 2, input, spaces) : MIN_SHEET_H;
  const height = Math.min(
    MAX_SHEET_H,
    Math.max(MIN_SHEET_H, Math.ceil(panelBottom + FOOTER_H + PAD)),
  );
  const mapW = height;
  const width = mapW + PANEL_W;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * DRAW_SCALE);
  canvas.height = Math.round(height * DRAW_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, width, height);

  // --- The building itself, filling its whole half of the sheet.
  //
  // This used to be drawn 1:1 from the top with the remainder filled by a flat
  // grey block — the band of dead space that appeared under every capture
  // whose square came out shorter than the panel needed. Scaling to COVER and
  // centring the overflow means the picture always reaches the bottom edge,
  // and the building is never stretched to get there.
  drawCover(ctx, mapImage, 0, 0, mapW, height);

  // A rule between picture and panel, so the two never bleed together.
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(mapW, 0, 1, height);

  const x = mapW + PAD;
  const w = PANEL_W - PAD * 2;
  const y = drawPanel(ctx, x, w, input, spaces);
  void y;

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
