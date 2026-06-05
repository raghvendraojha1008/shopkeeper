/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        primary: 'hsl(var(--primary) / <alpha-value>)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease both',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
        'shimmer': 'shimmer 1.5s linear infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: {
          from: { opacity: 0, transform: 'translateY(20px) scale(0.97)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        scaleIn: {
          from: { opacity: 0, transform: 'scale(0.92)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.15)',
        'card': '0 3px 14px rgba(0,0,0,0.07)',
        'float': '0 8px 32px rgba(0,0,0,0.16)',
        'amber': '0 6px 20px rgba(245,158,11,0.4)',
        'indigo': '0 6px 20px rgba(79,70,229,0.35)',
        'emerald': '0 6px 20px rgba(16,185,129,0.35)',
        'rose': '0 6px 20px rgba(239,68,68,0.35)',
      },
    },
  },
  plugins: [],
};

