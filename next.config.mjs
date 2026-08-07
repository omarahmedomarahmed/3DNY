/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox'],
  // /api/migrate reads db/schema.sql at runtime. Without this it is pruned
  // from the serverless bundle and the in-app "Create database tables" button
  // fails on Vercel while working fine locally.
  outputFileTracingIncludes: {
    '/api/migrate': ['./db/schema.sql'],
  },
  async headers() {
    return [
      {
        // Prototype has no auth gate. Keep it out of search engines.
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
