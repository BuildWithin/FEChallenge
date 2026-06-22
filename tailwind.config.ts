import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        periwinkle: {
          50: "var(--periwinkle-50)", 100: "var(--periwinkle-100)", 200: "var(--periwinkle-200)",
          300: "var(--periwinkle-300)", 400: "var(--periwinkle-400)", 500: "var(--periwinkle-500)",
          600: "var(--periwinkle-600)", 700: "var(--periwinkle-700)", 800: "var(--periwinkle-800)",
          900: "var(--periwinkle-900)", 950: "var(--periwinkle-950)",
        },
        neutral: {
          50: "var(--neutral-50)", 100: "var(--neutral-100)", 200: "var(--neutral-200)",
          300: "var(--neutral-300)", 400: "var(--neutral-400)", 500: "var(--neutral-500)",
          600: "var(--neutral-600)", 700: "var(--neutral-700)", 800: "var(--neutral-800)",
          850: "var(--neutral-850)", 900: "var(--neutral-900)", 950: "var(--neutral-950)",
        },
        background: "var(--color-background)",
        surface: {
          DEFAULT: "var(--color-surface)",
          subtle: "var(--color-surface-subtle)",
          muted: "var(--color-surface-muted)",
        },
        line: {
          DEFAULT: "var(--color-line)",
          strong: "var(--color-line-strong)",
          subtle: "var(--color-line-subtle)",
          faint: "var(--color-line-faint)",
        },
        foreground: {
          DEFAULT: "var(--color-foreground)",
          body: "var(--color-foreground-body)",
          muted: "var(--color-foreground-muted)",
          faint: "var(--color-foreground-faint)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          text: "var(--color-accent-text)",
          subtle: "var(--color-accent-subtle)",
        },
        "on-accent": "var(--color-on-accent)",
        "user-bubble": {
          DEFAULT: "var(--color-user-bubble)",
          fg: "var(--color-user-bubble-fg)",
        },
        ring: "var(--color-ring)",
        warning: {
          DEFAULT: "var(--color-warning)",
          subtle: "var(--color-warning-subtle)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
