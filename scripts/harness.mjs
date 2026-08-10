/**
 * Shared setup for the browser harnesses.
 *
 * The map now opens as a map: both rails closed, the control stack folded to
 * one button. That is the right first impression and it broke every script
 * here at once, because they all drove the app through chrome that is no
 * longer on screen — selecting a building by clicking its sidebar card,
 * toggling transit from the control stack.
 *
 * The fix belongs in one place rather than twelve. Each helper is a no-op when
 * the thing it opens is already open, so a script can call them freely and a
 * later change to the defaults only has to be absorbed here.
 */

/** Opens the results sidebar, which is how the harnesses pick a building. */
export async function openResults(page) {
  const button = page.getByRole('button', { name: /^Show spaces$/i });
  if ((await button.count()) > 0) {
    await button.first().click();
    await page.waitForTimeout(600);
  }
}

/** Opens the filter rail. */
export async function openFilters(page) {
  const button = page.getByRole('button', { name: /^Show filters$/i });
  if ((await button.count()) > 0) {
    await button.first().click();
    await page.waitForTimeout(600);
  }
}

/** Unfolds the control stack, so the individual tools can be clicked. */
export async function openControls(page) {
  const button = page.getByRole('button', { name: /^Map tools$/i });
  if ((await button.count()) > 0) {
    await button.first().click();
    await page.waitForTimeout(500);
  }
}

/**
 * The whole map, ready to be driven: canvas up, buildings loaded, results
 * sidebar open, tools unfolded.
 */
export async function openMapChrome(page) {
  await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
  await openResults(page);
  await openControls(page);
  await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
}
