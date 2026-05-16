/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,tsx,html}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: [
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      colors: {
        bg: "#0e0d0b",
        ink: "#f5f1ea",
        muted: "rgba(245, 241, 234, 0.55)",
        sub: "rgba(245, 241, 234, 0.65)",
        accent: "#d4ff50",
        "accent-dim": "rgba(212, 255, 80, 0.18)",
        "accent-line": "rgba(212, 255, 80, 0.35)",
        line: "rgba(255, 255, 255, 0.08)",
        card: "rgba(33, 31, 27, 0.65)",
        danger: "rgb(255, 130, 130)",
      },
      boxShadow: {
        glow: "0 0 36px rgba(212, 255, 80, 0.22)",
        card: "0 8px 24px rgba(0, 0, 0, 0.35)",
      },
      keyframes: {
        spin: {
          to: { transform: "rotate(360deg)" },
        },
        fadeUp: {
          from: { opacity: 0, transform: "translateY(6px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        spin: "spin 0.8s linear infinite",
        "fade-up": "fadeUp 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
