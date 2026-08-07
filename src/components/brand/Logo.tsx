import Link from 'next/link';

/**
 * The Cresa mark. It renders /brand/cresa-logo.svg, so dropping the official
 * artwork into public/brand/ replaces it everywhere with no code change.
 *
 * `product` appends the tool name beside the logo, divided by a hairline —
 * the pattern Cresa uses for sub-brands.
 */
export default function Logo({
  href = '/',
  product,
  className = '',
  height = 26,
  invert = false,
}: {
  href?: string | null;
  product?: string;
  className?: string;
  height?: number;
  invert?: boolean;
}) {
  const mark = (
    <span className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/cresa-logo.svg"
        alt="Cresa"
        height={height}
        style={{ height, width: 'auto' }}
        className={invert ? 'brightness-0 invert' : undefined}
      />
      {product && (
        <>
          <span
            aria-hidden
            className={`h-5 w-px ${invert ? 'bg-white/30' : 'bg-hairline-strong'}`}
          />
          <span
            className={`text-[13px] font-semibold uppercase tracking-[0.14em] ${
              invert ? 'text-white' : 'text-ink'
            }`}
          >
            {product}
          </span>
        </>
      )}
    </span>
  );

  if (!href) return <span className={className}>{mark}</span>;

  return (
    <Link href={href} className={`inline-flex items-center ${className}`} aria-label="Cresa home">
      {mark}
    </Link>
  );
}

/** The Goldenrod dot motif on its own, for accents and empty states. */
export function DotMotif({ className = '', size = 44 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/cresa-mark.svg"
      alt=""
      aria-hidden
      style={{ height: size, width: 'auto' }}
      className={className}
    />
  );
}
