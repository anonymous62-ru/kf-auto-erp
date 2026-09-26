import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'kf-navy': '#1B2A4A',
        'kf-red': '#C1272D',
        'kf-orange': '#F7941D',
      },
    },
  },
  plugins: [],
};
export default config;
