import type { Config } from 'tailwindcss';

/**
 * Cresa brand system. Light theme: white surfaces, Midnight type and
 * structure, Goldenrod for emphasis and the one thing you should look at.
 * Values mirror src/lib/brand.ts.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary
        midnight: {
          DEFAULT: '#001E5A',
          900: '#001640',
          800: '#001E5A',
          700: '#12306E',
          600: '#243E8C',
          500: '#3A4A6B',
          400: '#5C6B8A',
          300: '#8D98AE',
          200: '#C3CAD8',
          100: '#E4E8EF',
          50: '#F2F4F8',
        },
        goldenrod: {
          DEFAULT: '#FFB600',
          700: '#B37F00',
          600: '#D99B00',
          500: '#FFB600',
          400: '#FFC733',
          300: '#FFD666',
          200: '#FFE6A3',
          100: '#FFF4D6',
          50: '#FFFAEB',
        },
        // Secondary
        brightblue: '#0056DA',
        warmorange: '#FF8200',
        stadium: '#243E8C',

        // Neutrals
        surface: {
          DEFAULT: '#FFFFFF',
          alt: '#F7F8FA',
          sunken: '#F2F4F8',
        },
        hairline: {
          DEFAULT: '#E6E6E6',
          strong: '#D2D6DD',
        },
        ink: '#001E5A',
        body: '#2C3444',
        muted: '#595959',
        subtle: '#8A9099',

        // Status
        ok: { DEFAULT: '#1E7F4C', surface: '#E8F5EE' },
        warn: { DEFAULT: '#FF8200', surface: '#FFF3E5' },
        danger: { DEFAULT: '#C0392B', surface: '#FBEBE9' },
        info: { DEFAULT: '#0056DA', surface: '#E8F0FE' },
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 30, 90, 0.06), 0 1px 3px rgba(0, 30, 90, 0.04)',
        raised: '0 4px 12px rgba(0, 30, 90, 0.08), 0 1px 3px rgba(0, 30, 90, 0.06)',
        float: '0 12px 32px rgba(0, 30, 90, 0.14), 0 2px 8px rgba(0, 30, 90, 0.08)',
        focus: '0 0 0 3px rgba(255, 182, 0, 0.35)',
      },
      borderRadius: {
        card: '10px',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in': 'slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
