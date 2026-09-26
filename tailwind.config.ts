import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // === TOUCHCORE VALUESPOT — BLUEPRINT DESIGN SYSTEM ===
        // Base surfaces (Touchcore graphite / signal-red / chrome palette)
        bg:             '#f4f2f2',
        surface:        '#ebe9e9',
        'surface-secondary': '#e3e0e0',
        divider:        'rgba(22,22,26,0.16)',
        text:           '#16161a',

        // Background alias (keep for backward compat)
        background:     '#f4f2f2',
        border:         'rgba(22,22,26,0.16)',

        // Text ramp
        'text-primary':   '#16161a',
        'text-secondary': '#5f5b5c',
        'text-muted':     '#6a6668',
        'text-disabled':  '#9b9696',

        // Neutral ramp
        'neutral-100': '#f6f4f4',
        'neutral-200': '#eae7e7',
        'neutral-300': '#d7d3d3',
        'neutral-400': '#bab5b5',
        'neutral-500': '#9b9696',
        'neutral-600': '#6a6668',
        'neutral-700': '#5f5b5c',
        'neutral-800': '#434041',
        'neutral-900': '#2c2a2a',

        // Accent ramp — Touchcore signal red
        accent:         '#c42a20',
        'accent-2':     '#de584d',
        'accent-100':   '#fdf1ef',
        'accent-200':   '#fadfdb',
        'accent-300':   '#f3bcb5',
        'accent-400':   '#e98f86',
        'accent-500':   '#de584d',
        'accent-600':   '#c42a20',
        'accent-700':   '#a2211a',
        'accent-800':   '#7c1913',
        'accent-900':   '#55110c',

        // Accent-2 ramp
        'accent-2-100': '#fdf1ef',
        'accent-2-300': '#f3bcb5',
        'accent-2-600': '#c4746c',
        'accent-2-700': '#a2211a',
        'accent-2-800': '#7c1913',
        'accent-2-900': '#55110c',

        // Per-value tone colors (fixed assignments — brand-harmonised family)
        'value-adaptable':    '#2a6ea8',  // steel
        'value-transparent':  '#5b6b78',  // graphite
        'value-collaborative':'#be3a66',  // rose
        'value-innovative':   '#a25a0b',  // amber
        'value-accountable':  '#c42a20',  // signal red

        // Legacy tokens mapped to new system (backward compat)
        navy:   '#2a100d',
        blue:   { DEFAULT: '#c42a20', secondary: '#de584d' },
        teal:   '#c4746c',
        success: '#a2211a',
        warning: '#de584d',
        danger:  '#7c1913',
        info:    '#c42a20',

        // shadcn/ui required tokens
        input:       'rgba(22,22,26,0.16)',
        ring:        '#c42a20',
        foreground:  '#16161a',
        primary: {
          DEFAULT:    '#c42a20',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT:    '#ebe9e9',
          foreground: '#16161a',
        },
        destructive: {
          DEFAULT:    '#b01a14',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT:    '#ebe9e9',
          foreground: '#6a6668',
        },
        card: {
          DEFAULT:    'transparent',
          foreground: '#16161a',
        },
        popover: {
          DEFAULT:    '#f4f2f2',
          foreground: '#16161a',
        },
        accent: {
          DEFAULT:    '#c42a20',
          foreground: '#ffffff',
        },
      },
      borderRadius: {
        // Blueprint design uses square corners everywhere
        DEFAULT: '0px',
        none:  '0px',
        sm:    '0px',
        md:    '0px',
        lg:    '0px',
        xl:    '0px',
        '2xl': '0px',
        '3xl': '0px',
        full:  '9999px', // only for true circles/pills when explicitly needed
      },
      fontFamily: {
        // Blueprint design system fonts
        sans:       ['"Barlow"', 'system-ui', '-apple-system', 'sans-serif'],
        condensed:  ['"Barlow Condensed"', '"Barlow"', 'system-ui', 'sans-serif'],
        mono:       ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Blueprint type scale
        '3xs': ['9px',  { lineHeight: '1.3' }],
        '2xs': ['10px', { lineHeight: '1.3' }],
        xs:    ['11px', { lineHeight: '1.4' }],
        sm:    ['13px', { lineHeight: '1.5' }],
        base:  ['15px', { lineHeight: '1.55' }],
        lg:    ['16px', { lineHeight: '1.5' }],
        xl:    ['20px', { lineHeight: '1.3' }],
        '2xl': ['24px', { lineHeight: '1.25' }],
        '3xl': ['32px', { lineHeight: '1.15' }],
        '4xl': ['36px', { lineHeight: '1.1' }],
        '5xl': ['42px', { lineHeight: '1.1' }],
      },
      boxShadow: {
        sm:  '0 1px 2px rgba(0,0,0,0.06)',
        md:  '0 2px 8px rgba(0,0,0,0.08)',
        lg:  '0 4px 16px rgba(0,0,0,0.12)',
        xl:  '0 8px 24px rgba(0,0,0,0.14)',
      },
      spacing: {
        '13': '52px',
        '15': '60px',
        '18': '72px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // Every animation below ends at `transform: none`, never at an
        // identity transform such as translateY(0) or scale(1).
        //
        // These run with fill-mode `both`, so the final keyframe's value stays
        // applied for the life of the element. An element holding *any*
        // transform — an identity one included — becomes the containing block
        // for its position: fixed descendants. Since page roots carry
        // `animate-fade-in`, that silently re-anchored every modal backdrop
        // inside them: `inset: 0` covered the page container instead of the
        // viewport, so the screen dimmed and the dialog was centred somewhere
        // below the fold. `none` is not a transform, so no containing block is
        // created and fixed positioning behaves normally once the motion ends.
        'vs-rise': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'none' },
        },
        // Legacy aliases (used throughout existing pages)
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'none' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to:   { opacity: '1', transform: 'none' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to:   { opacity: '1', transform: 'none' },
        },
        'badge-pop': {
          '0%':   { transform: 'scale(0.9)', opacity: '0' },
          '70%':  { transform: 'scale(1.04)' },
          '100%': { transform: 'none', opacity: '1' },
        },
      },
      animation: {
        'accordion-down':  'accordion-down 0.2s ease-out',
        'accordion-up':    'accordion-up 0.2s ease-out',
        'vs-rise':         'vs-rise 260ms ease-out both',
        'fade-in':         'vs-rise 260ms ease-out both',
        'scale-in':        'scale-in 200ms ease-out',
        'slide-in-right':  'slide-in-right 200ms ease-out',
        'badge-pop':       'badge-pop 300ms ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
