/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox'],
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
