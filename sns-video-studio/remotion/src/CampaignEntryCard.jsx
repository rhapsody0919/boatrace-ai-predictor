import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { NAVY, GOLD, WHITE } from "./noteVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

const CARD_BG = "#142842";
const SUCCESS = "#4fd1a5";
const ERROR = "#f3908f";
const MUTED = "#9aa3ad";
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", "Hiragino Sans", sans-serif';

/**
 * 企画型SNSパイプライン（docs/design/sns-hub-campaign-pipeline/）の
 * X投稿用カード（静止画像、テキスト+画像形式）。1枚目「買い目カード」。
 *
 * 龍神レーダーは「AI予想を当てるサービス」ではなく「分析ツール」として
 * PRする方針（ユーザー確認済み）のため、内部の計算式・スコアは一切見せず、
 * 分析ツールに実在する項目名（勝率・展開予測の決まり手等）だけで
 * 「見えたポイント」を書く。可視化の実データはCampaignDataExcerptCard
 * （2枚目）が担い、本コンポーネントは買い目・収支の要約に専念する。
 *
 * variant='picks'（事前発表、運用フロー②）: hit/actualResultは表示しない
 * variant='result'（結果発表、運用フロー③）: hit/actualResultを表示する
 */
export function CampaignEntryCard({
  variant = "picks",
  dayLabel,
  headline,
  raceLine,
  picks = [],
  points = [],
  hit,
  actualResult,
  purchaseAmountYen,
  payoutYen,
  cumulativeNetYen,
  record,
}) {
  const { width } = useVideoConfig();
  const scale = width / 1200;

  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    headline,
    {
      maxWidth: width - 72 * scale * 2,
      maxLines: 2,
      fontFamily: FONT,
      fontWeight: 700,
      maxFontSize: 46 * scale,
      minFontSize: 28 * scale,
    },
  );

  const netPositive = (cumulativeNetYen ?? 0) >= 0;

  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        fontFamily: FONT,
        color: WHITE,
        padding: 72 * scale,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10 * scale,
          marginBottom: 18 * scale,
        }}
      >
        <div
          style={{
            width: 9 * scale,
            height: 9 * scale,
            borderRadius: "50%",
            background: GOLD,
          }}
        />
        <span style={{ color: GOLD, fontWeight: 700, fontSize: 20 * scale }}>
          龍神レーダー
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {dayLabel && (
          <div
            style={{
              color: MUTED,
              fontSize: 15 * scale,
              marginBottom: 4 * scale,
            }}
          >
            {dayLabel}
          </div>
        )}

        <div
          style={{
            color: WHITE,
            fontWeight: 700,
            fontSize: headlineFontSize,
            lineHeight: 1.35,
            marginBottom: 14 * scale,
          }}
        >
          {headlineLines.map((line, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i}>{line}</div>
          ))}
        </div>

        {raceLine && (
          <div
            style={{
              color: "#cfd6dd",
              fontSize: 16 * scale,
              marginBottom: 16 * scale,
            }}
          >
            {raceLine}
          </div>
        )}

        <div
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 6 * scale,
            background:
              variant === "picks"
                ? "rgba(201,162,39,0.15)"
                : hit
                  ? "rgba(16,185,129,0.15)"
                  : "rgba(239,68,68,0.15)",
            color: variant === "picks" ? "#e8c96a" : hit ? SUCCESS : ERROR,
            fontSize: 13 * scale,
            fontWeight: 700,
            padding: `${5 * scale}px ${13 * scale}px`,
            borderRadius: 999,
            marginBottom: 18 * scale,
          }}
        >
          {variant === "picks"
            ? "事前発表・結果はまだ出ていません"
            : hit
              ? "的中"
              : "不的中"}
        </div>

        <div
          style={{ display: "flex", gap: 9 * scale, marginBottom: 18 * scale }}
        >
          {picks.map((combo) => (
            <div
              key={combo}
              style={{
                flex: 1,
                background: CARD_BG,
                borderRadius: 8 * scale,
                textAlign: "center",
                padding: `${13 * scale}px 0`,
                fontSize: 21 * scale,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {combo}
            </div>
          ))}
        </div>

        {variant === "result" && actualResult && (
          <div
            style={{
              color: "#cfd6dd",
              fontSize: 15 * scale,
              marginBottom: 18 * scale,
            }}
          >
            実際の着順: {actualResult}
          </div>
        )}

        {variant === "picks" && points.length > 0 && (
          <>
            <div
              style={{
                color: MUTED,
                fontSize: 13 * scale,
                fontWeight: 700,
                marginBottom: 8 * scale,
              }}
            >
              分析ツールで見えたポイント
            </div>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                fontSize: 15 * scale,
                lineHeight: 1.7,
                color: "#e7ebef",
                marginBottom: 24 * scale,
              }}
            >
              {points.map((point) => (
                <li key={point} style={{ marginBottom: 6 * scale }}>
                  {point}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          paddingTop: 18 * scale,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11 * scale,
              color: MUTED,
              marginBottom: 4 * scale,
            }}
          >
            {variant === "picks" ? "購入額" : "払戻"}
          </div>
          <div style={{ fontSize: 19 * scale, fontWeight: 700 }}>
            {variant === "picks" ? `${purchaseAmountYen}円` : `${payoutYen}円`}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 11 * scale,
              color: MUTED,
              marginBottom: 4 * scale,
            }}
          >
            通算収支
          </div>
          <div
            style={{
              fontSize: 19 * scale,
              fontWeight: 700,
              color: netPositive ? SUCCESS : ERROR,
            }}
          >
            {netPositive ? "+" : ""}
            {cumulativeNetYen}円
          </div>
        </div>
        {record && (
          <div>
            <div
              style={{
                fontSize: 11 * scale,
                color: MUTED,
                marginBottom: 4 * scale,
              }}
            >
              ここまで
            </div>
            <div style={{ fontSize: 19 * scale, fontWeight: 700 }}>
              {record}
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
