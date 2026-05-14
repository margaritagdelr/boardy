/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1A1916',
          soft: 'rgba(26, 25, 22, 0.55)',
          mute: 'rgba(26, 25, 22, 0.08)',
        },
        terracota: {
          DEFAULT: '#D97757',
          50:  '#FDF5F0',
          100: '#FBE9D7',
          200: '#F5CDA8',
          300: '#EEA77B',
          400: '#E48E68',
          500: '#D97757',
          600: '#C16142',
          700: '#A04E35',
          800: '#7F3D2A',
        },
        cream: '#F1ECE1',
        paper: {
          DEFAULT: '#F6F5F0',
          soft: 'rgba(246, 245, 240, 0.55)',
        },
        sage: {
          DEFAULT: '#D8DFD1',
          50:  '#F3F5F0',
          100: '#E5EAE0',
          200: '#D8DFD1',
          300: '#BFC8B7',
          600: '#6B8C5F',
          700: '#536F4A',
        },
        ochre: {
          DEFAULT: '#C49A4B',
          100: '#F5ECD6',
          700: '#8C6E2D',
        },
      },
      fontFamily: {
        sans: ['"Inter Tight"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'monospace'],
      },
      borderRadius: {
        // sm: 0.125rem (default) — fine; we'll mostly use md/lg/xl
        md: '10px',
        lg: '16px',
        xl: '22px',
      },
      boxShadow: {
        sm: '0 4px 12px -8px rgba(0, 0, 0, 0.2)',
        DEFAULT: '0 4px 12px -8px rgba(0, 0, 0, 0.2)',
        md: '0 12px 32px -18px rgba(0, 0, 0, 0.3)',
        lg: '0 24px 60px -34px rgba(0, 0, 0, 0.4)',
      },
      letterSpacing: {
        tight2: '-0.025em',
        tight3: '-0.03em',
      },
    },
  },
  plugins: [],
};
