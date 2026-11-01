import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        nse: {
          dark: "#0b1320",
          card: "#111c2e",
          tableHeader: "#16233b",
          border: "#1e3250",
          yellowTint: "#26230f", // ITM yellow tint in dark mode
          yellowBorder: "#854d0e",
          green: "#10b981",
          red: "#f43f5e",
        },
      },
    },
  },
  plugins: [],
};
export default config;

