import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        heureka: {
          50: "#f0f0ff",
          100: "#e0e0ff",
          200: "#c8c8ff",
          300: "#a0a0ff",
          400: "#6060ff",
          500: "#3000f0",
          600: "#2800c8",
          700: "#2000a0",
          800: "#180078",
          900: "#100050",
        },
        navy: {
          900: "#000020",
          800: "#101040",
          700: "#202060",
        },
      },
    },
  },
  plugins: [animate],
} satisfies Config;
