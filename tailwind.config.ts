import type { Config } from "tailwindcss";

/**
 * 色は参考にしたメディカルダッシュボードからの抽出値。詳細は globals.css。
 *
 * 各色は4段で持つ。
 *   DEFAULT 塗り（参考画像の実測値）
 *   pale    枠・細い線
 *   soft    淡い面
 *   on      塗りの上に置く文字（4.6:1以上）
 *   ink     白・地の上に置く文字（4.6:1以上）
 *
 * 角丸は役割で変える。カード16px / ボタン・チップ12px / タグ8px / ピル999px
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        card: "var(--card)",
        panel: "var(--panel)",
        line: "var(--line)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        teal: {
          DEFAULT: "var(--teal)",
          pale: "var(--teal-pale)",
          soft: "var(--teal-soft)",
          on: "var(--teal-on)",
          ink: "var(--teal-ink)",
        },
        coral: {
          DEFAULT: "var(--coral)",
          pale: "var(--coral-pale)",
          soft: "var(--coral-soft)",
          on: "var(--coral-on)",
          ink: "var(--coral-ink)",
        },
        amber: {
          DEFAULT: "var(--amber)",
          pale: "var(--amber-pale)",
          soft: "var(--amber-soft)",
          on: "var(--amber-on)",
          ink: "var(--amber-ink)",
        },
      },
      borderRadius: { card: "16px", btn: "12px", tag: "8px" },
      boxShadow: { soft: "var(--shadow-soft)", lift: "var(--shadow-lift)" },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Hiragino Sans"',
          '"Noto Sans JP"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
