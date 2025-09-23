/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2563eb", // main brand blue
          light: "#3b82f6",
          dark: "#1e40af",
          hover: "#1d4ed8", // optional hover shade
        },
        accent: {
          DEFAULT: "#f59e0b", // example accent color
          light: "#fbbf24",
          dark: "#b45309",
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        heading: ['Poppins', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
};