import React from "react";
import { AbsoluteFill } from "remotion";
import { Pop, Logo, NAVY, WHITE, GOLD, FONT } from "./noteVideoShared.jsx";

/**
 * X/TikTok向けショート動画（縦型 1080x1920）共通CTAコンポーネント。
 *
 * 21本の動画テンプレート（*CM.jsx）がそれぞれ独自にSceneCTAを実装しており、
 * ロゴが絵文字🐉ベースだったり画像が一切無かったりと不統一だった
 * （2026-09-01、brand-kit.md監査で発見）。noteVideoShared.jsxの実ロゴ
 * Logoコンポーネントを再利用し、CTA文言も基本型「[話題]、無料で見れる/使える」
 * に統一する。既存21テンプレートの移行はBOA-232で個別に行う（本ファイルの
 * 新設はその第一歩）。詳細: docs/reference/brand-kit.md「X / TikTok 動画CTA」
 *
 * @param {string[]} ctaLines - 2行のCTA文言。基本型「[話題]、無料で見れる/使える」
 *   例: ["全24会場のデータ、", "無料で見れる"]
 * @param {string} [subLine] - ctaLinesの下に表示する補足文（省略可）
 */
export function SceneCTA({ ctaLines, subLine }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, #081b2e 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={4}>
        <div
          style={{
            color: WHITE,
            fontSize: 44,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          {ctaLines[0]}
          <br />
          {ctaLines[1]}
        </div>
      </Pop>
      {subLine && (
        <Pop delay={16} style={{ marginBottom: 40 }}>
          <div
            style={{
              color: "rgba(248,250,252,0.7)",
              fontSize: 26,
              fontFamily: FONT,
            }}
          >
            {subLine}
          </div>
        </Pop>
      )}
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
      <Pop delay={34} style={{ marginTop: 14 }}>
        <div
          style={{
            color: GOLD,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
            letterSpacing: 0.5,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}
