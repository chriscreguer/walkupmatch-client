/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        spotify: '#1DB954',
        'bg-gray-800': '#1e1e1e', // For navbar
        'primary-bg': '#E5E5E5',
      },
      fontFamily: {
        'dm-sans': ['"DM Sans"', 'sans-serif'],
      },
      borderRadius: {
        'full': '9999px',
      }
    },
  },
  plugins: [],
}