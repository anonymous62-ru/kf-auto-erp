import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Inter Display"', '"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Système « cockpit » (maquette du 13/10/2026).
        // Gris de l'application alignés sur les encres et traits de la maquette
        // (gris bleutés) : les écrans existants suivent sans réécriture.
        gray: {
          50: '#F5F6F8',
          100: '#EDF0F4',
          200: '#E2E6EC',
          300: '#CDD3DC',
          400: '#9AA4B4',
          500: '#6B7689',
          600: '#46536A',
          700: '#344157',
          800: '#1F2A3C',
          900: '#0F1826',
        },
        nuit: { DEFAULT: '#0D1B2E', 2: '#14263F', 3: '#1D3352' },
        acier: { DEFAULT: '#8A9BB2', 2: '#5E7090' },
        papier: '#F5F6F8',
        trait: { DEFAULT: '#E2E6EC', 2: '#EDF0F4' },
        encre: { DEFAULT: '#0F1826', 2: '#46536A', 3: '#8590A2' },
        rouge: { DEFAULT: '#D7262E', clair: '#FCE9EA' },
        'kf-navy': '#0D1B2E',
        // Déclinaisons de la couleur navy de la charte, pour la barre latérale
        // (plus sombre) et les états de survol (légèrement plus clair).
        'kf-navy-950': '#0E1729',
        'kf-navy-900': '#13203A',
        'kf-navy-700': '#1D3352',
        'kf-navy-400': '#3B5486',
        'kf-red': '#D7262E',
        'kf-orange': '#F7941D',
      },
    },
  },
  plugins: [],
};
export default config;
