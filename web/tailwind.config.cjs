module.exports = {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif']
      },
      colors: {
        night: {
          900: '#0a0f1a',
          800: '#0f172a',
          700: '#111c33'
        }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(56,189,248,0.25), 0 18px 40px rgba(15,23,42,0.5)'
      }
    }
  },
  plugins: []
};
