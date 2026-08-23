const tone = (name) => `rgb(var(--tone-${name}) / <alpha-value>)`;

const semanticRamp = (role) => ({
  50: tone(`${role}-weak`),
  100: tone(`${role}-weak`),
  200: tone(`${role}-soft`),
  300: tone(`${role}-soft`),
  400: tone(role),
  500: tone(role),
  600: tone(`${role}-strong`),
  700: tone(`${role}-strong`),
  800: tone(`${role}-strong`),
  900: tone(`${role}-deep`),
  950: tone(`${role}-deep`),
});

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--color-bg)',
        'bg-secondary': 'var(--color-bg-secondary)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        'surface-active': 'var(--color-surface-active)',
        border: 'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        'border-faint': 'var(--color-border-faint)',
        accent: {
          DEFAULT: 'var(--color-accent)',
          light: 'var(--color-accent-light)',
          dark: 'var(--color-accent-dark)',
          bg: 'var(--color-accent-bg)',
          border: 'var(--color-accent-border)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          bg: 'var(--color-danger-bg)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          bg: 'var(--color-warning-bg)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          bg: 'var(--color-success-bg)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          bg: 'var(--color-info-bg)',
        },
        feature: {
          DEFAULT: 'var(--color-feature)',
          bg: 'var(--color-feature-bg)',
        },
        overlay: 'rgb(var(--tone-overlay) / <alpha-value>)',
        'control-knob': 'var(--color-control-knob)',
        'on-accent': 'var(--color-text-on-accent)',

        // Compatibility aliases: existing upstream palette utilities are routed
        // through semantic skin tokens instead of bypassing the design system.
        emerald: semanticRamp('success'),
        green: semanticRamp('success'),
        amber: semanticRamp('warning'),
        yellow: semanticRamp('warning'),
        red: semanticRamp('danger'),
        sky: semanticRamp('info'),
        blue: semanticRamp('info'),
        violet: semanticRamp('feature'),
        purple: semanticRamp('feature'),
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        dialog: 'var(--shadow-dialog)',
        'control-knob': 'var(--shadow-control-knob)',
        'highlight-inset': 'var(--shadow-highlight-inset)',
      },
      textColor: {
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
        muted: 'var(--color-text-muted)',
        faint: 'var(--color-text-faint)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius-xs)',
        sm: 'var(--radius-xs)',
        md: 'var(--radius-sm)',
        lg: 'var(--radius-control)',
        xl: 'var(--radius-panel)',
        '2xl': 'calc(var(--radius-panel) + 4px)',
        '3xl': 'calc(var(--radius-panel) + 12px)',
        dialog: 'var(--radius-dialog)',
        full: 'var(--radius-pill)',
      },
      transitionDuration: {
        instant: 'var(--duration-instant)',
        fast: 'var(--duration-fast)',
        standard: 'var(--duration-standard)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        'smooth-out': 'var(--ease-smooth-out)',
      },
    },
  },
  plugins: [],
}
