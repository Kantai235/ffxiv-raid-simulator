import type { Config } from 'tailwindcss';

/**
 * Tailwind 設定 - Player 前台。
 *
 * 採用 FFXIV UI 風格的暗色色系（藍黑為底、金色點綴），
 * 之後可在這裡擴充 theme.colors 統一管理。
 */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        ffxiv: {
          bg: '#0E1A2B',
          panel: '#1A2A40',
          accent: '#D4AF37',
          danger: '#E74C3C',
          safe: '#27AE60',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
