import React from "react";
import { AbsoluteFill } from "remotion";
import { Pop, Logo, NAVY, WHITE, GOLD, FONT } from "./noteVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

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
 *
 * シーンのフック強度均一化（docs/reference/brand-kit.md）: 従来は本文44px WHITE・
 * ドメイン24px GOLDのいずれも画面幅10%(108px)未満で「弱いシーン」判定だった。
 * ドメイン表記「boat-ai.jp」をfitHeadline()で108px以上のGOLD・fontWeight900の
 * 主役テキストへ拡大する（1箇所の修正で本コンポーネントを使う全コンポジションに
 * 波及する）。
 */
export function SceneCTA({ ctaLines, subLine }) {
  const domainFit = fitHeadline("boat-ai.jp", {
    maxWidth: 940,
    maxLines: 1,
    fontFamily: FONT,
    fontWeight: 900,
    maxFontSize: 160,
    minFontSize: 108,
  });
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
        <Pop delay={16} style={{ marginBottom: 32 }}>
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
      <Pop delay={28} style={{ marginBottom: 20 }}>
        <Logo size={48} />
      </Pop>
      <Pop delay={34}>
        <div
          style={{
            color: GOLD,
            fontSize: domainFit.fontSize,
            fontWeight: 900,
            fontFamily: FONT,
            letterSpacing: 0.5,
            textShadow: `0 0 60px ${GOLD}66`,
          }}
        >
          {domainFit.lines[0]}
        </div>
      </Pop>
    </AbsoluteFill>
  );
}
