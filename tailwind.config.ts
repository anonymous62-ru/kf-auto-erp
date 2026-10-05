import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'kf-navy': '#1B2A4A',
        // Déclinaisons de la couleur navy de la charte, pour la barre latérale
        // (plus sombre) et les états de survol (légèrement plus clair).
        'kf-navy-950': '#0E1729',
        'kf-navy-900': '#13203A',
        'kf-navy-700': '#24365E',
        'kf-navy-400': '#3B5486',
        'kf-red': '#C1272D',
        'kf-orange': '#F7941D',
      },
    },
  },
  plugins: [],
};
export default config;
