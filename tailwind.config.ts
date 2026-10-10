import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        "display-lg": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em", fontWeight: "800" }],
        "display-md": ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em", fontWeight: "800" }],
        "display-sm": ["1.125rem", { lineHeight: "1.5rem", letterSpacing: "-0.01em", fontWeight: "700" }],
        price: ["0.9375rem", { lineHeight: "1.25rem", letterSpacing: "-0.01em", fontWeight: "800" }],
      },
      transitionDuration: {
        micro: "var(--dur-micro)",
        macro: "var(--dur-macro)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Semantic colors
        veg: "hsl(var(--veg))",
        "non-veg": "hsl(var(--non-veg))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        favorite: "hsl(var(--favorite))",
        // Badge & accent colors
        "badge-new": "hsl(var(--badge-new))",
        "badge-bought": "hsl(var(--badge-bought))",
        "badge-discount": "hsl(var(--badge-discount))",
        "rating-star": "hsl(var(--rating-star))",
        "nav-active": "hsl(var(--nav-active))",
        "nav-active-foreground": "hsl(var(--nav-active-foreground))",
        // Commerce modes
        "mode-shop": {
          DEFAULT: "hsl(var(--mode-shop))",
          foreground: "hsl(var(--mode-shop-foreground))",
          ink: "hsl(var(--mode-shop-ink))",
        },
        "mode-book": {
          DEFAULT: "hsl(var(--mode-book))",
          foreground: "hsl(var(--mode-book-foreground))",
          ink: "hsl(var(--mode-book-ink))",
        },
        "mode-services": {
          DEFAULT: "hsl(var(--mode-services))",
          foreground: "hsl(var(--mode-services-foreground))",
          ink: "hsl(var(--mode-services-ink))",
        },
        offer: {
          DEFAULT: "hsl(var(--offer))",
          foreground: "hsl(var(--offer-foreground))",
          ink: "hsl(var(--offer-ink))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
        "3xl": "calc(var(--radius) + 14px)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
        cta: "var(--shadow-cta)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmer: "shimmer 2s infinite",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      spacing: {
        "safe-bottom": "var(--app-safe-bottom)",
        "safe-top": "var(--app-safe-top)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
