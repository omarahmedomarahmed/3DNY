import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0d1117',
        panel: '#161b22',
        edge: '#2b3441',
        muted: '#8b949e',
        accent: '#4c9aff',
        warn: '#e3a008',
        danger: '#f2545b',
        ok: '#3fb950',
      },
    },
  },
  plugins: [],
} satisfies Config;
