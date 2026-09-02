import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { NAVY, GOLD, WHITE, FONT } from "./noteVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

const TAGLINE = "ボートレースを見える化。迷ったら、データを信じる。";
const HEADLINE_WEIGHT = 800;

/**
 * ブログ/note/YouTubeサムネイル共通のカバー画像静止画（frame=0固定）。
 *
 * 実画面のスクリーンショットが無いネタ（会場特性・成績等）向けの
 * フォールバック。docs/reference/brand-kit.md参照。
 *
 * 2026-09-02、3回の修正を経て確定した構成:
 * 1st案（header-eそのまま流用）: 前景ロゴが大きすぎ動的見出しと衝突、
 *   サイト名・タグラインが画面から消える、の2点で却下
 * 2nd案（ロゴを低不透明度の背景テクスチャに格下げ）: 衝突は解消したが
 *   「主役感が無い・空間が間延びして見える」「見出しは常にゴールドで」
 *   という指摘で却下
 * 3rd案（この版）: ロゴは前景・フル不透明度のまま維持しつつ幅を絞り
 *   （0.62→0.5）テキスト領域と衝突しない余白を確保。見出しはゴールド
 *   固定。ブランドロックアップ（アイコン＋サイト名＋タグライン）と
 *   見出し・データを1つの縦積みブロックとして垂直中央に配置し、
 *   上下の空白を詰めて密度を上げた
 *
 * 幅・高さはComposition側で指定（ブログ/note用1200x630、
 * YouTubeサムネイル用1280x720）し、サイズはキャンバス幅に対する
 * 比率で決めるため両サイズで破綻しない。
 */
export function DataQuoteCard({ headline, statValue, statLabel, caption }) {
  const { width, height } = useVideoConfig();
  const scale = width / 1200;
  const logoWidth = width * 0.5;
  const headlineMaxWidth = width * 0.5;

  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    headline,
    {
      maxWidth: headlineMaxWidth,
      maxLines: 2,
      fontFamily: FONT,
      fontWeight: HEADLINE_WEIGHT,
      maxFontSize: 48 * scale,
      minFontSize: 28 * scale,
    },
  );

  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        fontFamily: FONT,
      }}
    >
      {/* 前景ロゴ（フル不透明度、右端でブリード） */}
      <Img
        src={staticFile("logo-light.png")}
        style={{
          position: "absolute",
          right: -logoWidth * 0.18,
          top: height / 2,
          transform: "translateY(-50%)",
          width: logoWidth,
          height: "auto",
        }}
      />

      {/* コンテンツブロック（ブランドロックアップ＋見出し・データ、垂直中央に密集配置） */}
      <div
        style={{
          position: "absolute",
          left: 56 * scale,
          top: "50%",
          transform: "translateY(-50%)",
          maxWidth: width * 0.5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 * scale }}>
          <Img
            src={staticFile("logo-light.png")}
            style={{
              width: 34 * scale,
              height: 34 * scale,
              objectFit: "contain",
            }}
          />
          <span
            style={{
              color: GOLD,
              fontSize: 22 * scale,
              fontWeight: 700,
            }}
          >
            龍神レーダー
          </span>
        </div>
        <div
          style={{
            color: WHITE,
            fontSize: 14 * scale,
            opacity: 0.8,
            marginTop: 4 * scale,
          }}
        >
          {TAGLINE}
        </div>

        <div
          style={{
            color: GOLD,
            fontSize: headlineFontSize,
            fontWeight: HEADLINE_WEIGHT,
            lineHeight: 1.3,
            marginTop: 28 * scale,
            textShadow: "0 2px 10px rgba(0,0,0,0.4)",
          }}
        >
          {headlineLines.map((line, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i}>{line}</div>
          ))}
        </div>

        {statValue ? (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10 * scale,
              marginTop: 20 * scale,
            }}
          >
            <span
              style={{
                color: WHITE,
                fontSize: 40 * scale,
                fontWeight: 800,
              }}
            >
              {statValue}
            </span>
            {statLabel && (
              <span
                style={{
                  color: WHITE,
                  fontSize: 20 * scale,
                  opacity: 0.85,
                }}
              >
                {statLabel}
              </span>
            )}
          </div>
        ) : null}

        {caption && (
          <div
            style={{
              color: WHITE,
              fontSize: 19 * scale,
              opacity: 0.8,
              lineHeight: 1.6,
              marginTop: statValue ? 10 * scale : 20 * scale,
            }}
          >
            {caption}
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          left: 56 * scale,
          bottom: 36 * scale,
          color: GOLD,
          fontSize: 16 * scale,
          fontWeight: 700,
          letterSpacing: 2 * scale,
          textTransform: "uppercase",
        }}
      >
        boat-ai.jp
      </div>
    </AbsoluteFill>
  );
}
