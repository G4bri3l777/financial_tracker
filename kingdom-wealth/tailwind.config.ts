import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        kw: {
          navy:   "#1B2A4A",
          gold:   "#C9A84C",
          muted:  "#9AA5B4",
          border: "#E4E8F0",
          bg:     "#F4F6FA",
          soft:   "#F9FAFC",
        },
      },
    },
  },
  plugins: [],
};
export default config;
