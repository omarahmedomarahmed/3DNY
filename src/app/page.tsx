import Link from 'next/link';
import Logo, { DotMotif } from '@/components/brand/Logo';
import LandingStats from '@/components/landing/LandingStats';
import LandingPreview from '@/components/landing/LandingPreview';
import { SkylineBand, SkylineHero, TowerMark, GridPattern } from '@/components/brand/Skyline';
import Icon, { type IconName } from '@/components/ui/Icon';

export const metadata = {
  title: 'Cresa Spaces — Manhattan office availability in 3D',
};

const CAPABILITIES: { title: string; body: string; icon: IconName }[] = [
  {
    icon: 'floor',
    title: 'Every available floor, on the tower',
    body: 'Zoom into a building and each available floor is its own highlighted band. Click one and the space opens — size, asking rent, term, agent.',
  },
  {
    icon: 'compare',
    title: 'Compare across buildings',
    body: 'Add a floor here, fly across town, add another. Specs sit side by side, landlord data included, and the comparison is a link you can send.',
  },
  {
    icon: 'map-pin',
    title: 'Comps within a radius',
    body: 'Draw a quarter mile around the building your tenant is considering. Every competing availability inside it, ranked by distance.',
  },
  {
    icon: 'filter',
    title: 'Filter on anything in the sheet',
    body: 'Lease expiration, asking rent, size, floor, class, direct or sublet, submarket, leasing company. Every column you already track.',
  },
  {
    icon: 'building',
    title: 'Landlord intelligence',
    body: 'The things only your team knows — how a landlord actually negotiates, what the building runs like — written once and surfaced in every comparison.',
  },
  {
    icon: 'edit',
    title: 'Correct anything, instantly',
    body: 'Every imported row is editable in the app. Add photos to a space, fix a floor, update a tenant roster. No re-import.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* ---------------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <Logo href={null} product="Spaces" />
          <nav className="ml-auto flex items-center gap-6 text-sm">
            <Link href="/import" className="hidden text-muted hover:text-ink sm:inline">
              Upload a sheet
            </Link>
            <Link
              href="/map"
              className="rounded bg-midnight px-4 py-2 font-medium text-white transition-colors hover:bg-midnight-700"
            >
              Open the map
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero ------------------------------------------------------------ */}
      <section className="relative overflow-hidden border-b border-hairline bg-midnight">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #FFB600 1px, transparent 1px), linear-gradient(to bottom, #FFB600 1px, transparent 1px)',
            backgroundSize: '72px 72px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 70% 40%, black, transparent)',
          }}
        />

        {/* The city itself, sitting on the bottom edge of the hero. Decorative
            only — everything above it stays legible if it fails to paint. */}
        {/* Held to the bottom edge and faded upward so the stat row above it
            stays the brightest thing in the hero. */}
        <SkylineHero
          className="pointer-events-none absolute inset-x-0 bottom-0 block h-32 w-full opacity-50 sm:h-44"
          style={{
            maskImage: 'linear-gradient(to top, black 45%, transparent)',
            WebkitMaskImage: 'linear-gradient(to top, black 45%, transparent)',
          }}
        />

        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-24">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-goldenrod">
              <span className="h-1.5 w-1.5 bg-goldenrod" />
              Tenant Advisory · New York
            </span>

            <h1 className="mt-6 text-[2.6rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
              Manhattan availability,
              <br />
              <span className="text-goldenrod">building by building.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              Drop in the weekly availability sheet and every building with new space lights
              up in 3D. Show a tenant the floor they asked about, then three better options
              within a quarter mile — without leaving the map.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/map"
                className="rounded bg-goldenrod px-6 py-3 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5"
              >
                Open the map
              </Link>
              <Link
                href="/import"
                className="rounded border border-white/25 px-6 py-3 text-sm font-medium text-white transition-colors hover:border-goldenrod hover:text-goldenrod"
              >
                Upload this week&apos;s sheet
              </Link>
            </div>

            <LandingStats />
          </div>

          <LandingPreview />
        </div>
      </section>

      {/* The moment it has to win ---------------------------------------- */}
      <section className="border-b border-hairline bg-surface-alt">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                Built for one moment
              </p>
              <h2 className="rule-gold mt-3 text-2xl font-semibold tracking-tight text-ink">
                Thirty seconds across a conference table
              </h2>
            </div>
            <p className="text-lg leading-relaxed text-body">
              A tenant names the building they are considering. You pull it up, show the
              floors that are actually available, and put three better options beside it —
              with rents, floor sizes and the landlord&apos;s real posture. Every decision in
              this tool was judged against that half minute. If it does not help in that
              room, it is not here.
            </p>
          </div>
        </div>
      </section>

      {/* Capabilities ----------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          What it does
        </p>
        <h2 className="rule-gold mt-3 text-2xl font-semibold tracking-tight text-ink">
          Everything in the weekly sheet, on the skyline
        </h2>

        <div className="mt-14 grid gap-px overflow-hidden rounded-card border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <article key={c.title} className="group bg-white p-6 transition-colors hover:bg-goldenrod-50">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded bg-midnight-50 text-midnight transition-colors group-hover:bg-midnight group-hover:text-goldenrod">
                  <Icon name={c.icon} size={18} />
                </span>
                <span className="text-xs font-semibold tabular text-goldenrod-600">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold leading-snug text-ink">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works ------------------------------------------------------ */}
      <section className="border-y border-hairline bg-surface-alt">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            How it works
          </p>
          <h2 className="rule-gold mt-3 text-2xl font-semibold tracking-tight text-ink">
            Three steps, once a week
          </h2>

          <ol className="mt-14 grid gap-8 md:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Drop the sheet in',
                d: 'The same "Space Added This Week" file your team already produces. No reformatting, no new columns.',
              },
              {
                n: '02',
                t: 'Confirm anything ambiguous',
                d: 'Addresses are matched to official NYC building records. The handful that are genuinely unclear get one click — and are remembered forever.',
              },
              {
                n: '03',
                t: 'Open the map',
                d: 'Every building with new space is live, clickable and comparable. Ready for the next meeting.',
              },
            ].map((s) => (
              <li key={s.n} className="border-t-2 border-goldenrod pt-5">
                <span className="text-xs font-semibold tabular text-goldenrod-600">{s.n}</span>
                <h3 className="mt-2 text-base font-semibold text-ink">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Accuracy — stated plainly ---------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              Accuracy
            </p>
            <h2 className="rule-gold mt-3 text-2xl font-semibold tracking-tight text-ink">
              What this tool knows, and what it estimates
            </h2>
            <p className="mt-8 text-sm leading-relaxed text-muted">
              A wrong building highlighted in front of a client is worse than no map at all,
              so nothing is guessed silently.
            </p>
            <div className="mt-8 flex items-end gap-4">
              <TowerMark size={132} />
              <p className="pb-2 text-xs leading-relaxed text-subtle">
                Goldenrod bands are the floors your sheet says are available.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-hairline">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-hairline">
                {[
                  ['Which building', 'Exact', "Matched to the city's Building Identification Number."],
                  ['Which floor is available', 'Exact', 'Read straight from your sheet.'],
                  [
                    'Where the floor sits on the tower',
                    'Estimated',
                    'Roof height divided by floor count — within about one floor on towers with mechanical levels. Overridable per building.',
                  ],
                ].map(([what, level, why]) => (
                  <tr key={what} className="bg-white">
                    <td className="px-5 py-4 align-top font-medium text-ink">{what}</td>
                    <td className="px-5 py-4 align-top">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                          level === 'Exact'
                            ? 'bg-ok-surface text-ok'
                            : 'bg-warn-surface text-warn'
                        }`}
                      >
                        {level}
                      </span>
                    </td>
                    <td className="px-5 py-4 align-top text-muted">{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA --------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-t border-hairline bg-midnight">
        <GridPattern
          className="pointer-events-none absolute inset-0 text-goldenrod"
          id="cresa-cta-grid"
          opacity={0.14}
        />
        <SkylineBand
          className="pointer-events-none absolute inset-x-0 bottom-0 block h-24 w-full opacity-40"
          fill="#243E8C"
          accent={null}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Ready for the next meeting
            </h2>
            <p className="mt-2 max-w-lg text-white/70">
              Open the map, or start by uploading the sheet from this week.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/map"
              className="rounded bg-goldenrod px-6 py-3 text-sm font-semibold text-midnight transition-transform hover:-translate-y-0.5"
            >
              Open the map
            </Link>
            <Link
              href="/import"
              className="rounded border border-white/25 px-6 py-3 text-sm font-medium text-white transition-colors hover:border-goldenrod hover:text-goldenrod"
            >
              Upload a sheet
            </Link>
          </div>
        </div>
      </section>

      {/* Footer ------------------------------------------------------------ */}
      <footer className="border-t border-hairline bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center">
          <Logo href={null} height={22} variant="footer" />
          <p className="text-xs leading-relaxed text-subtle sm:ml-auto sm:max-w-md sm:text-right">
            Internal tenant-advisory tool. This prototype has no sign-in — anyone with the
            link can open it, so confidential landlord economics should stay out of it.
          </p>
        </div>
        <div className="border-t border-hairline">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
            <DotMotif size={18} />
            <span className="text-[11px] text-subtle">
              Building geometry from NYC Open Data. Availability from your weekly sheet.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
