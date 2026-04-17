import type { Config } from 'tailwindcss';

/**
 * Tailwind 設定 - Editor 工具。
 * 採與 player 不同的中性灰色系，避免出題者誤以為自己在玩練習版。
 */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#1F2937',
          panel: '#374151',
          accent: '#10B981',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
