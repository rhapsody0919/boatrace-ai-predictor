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
 *
 * v5（2026-09-09、縦型化）: 主な閲覧環境がスマホのタイムラインであることを
 * 踏まえ、キャンバスを16:9横型（1200x675）から4:5縦型（1080x1350）に変更した。
 * 単純な引き伸ばしではなく、増えた縦方向の余白を活かして買い目3点を横並び
 * ではなく縦積みにし（本命に「本命」バッジを追加）、見出し・heroStatの
 * フォントも拡大した。フッターは`marginTop:"auto"`でカード下端に固定し、
 * 内容量が日によって変動しても（ポイント数の増減等）中央に不自然な空白が
 * できないようにしている（v4での「余白が事故る」問題の教訓、内容を
 * 上から自然に積んで余りをフッター前の1箇所に集約する設計）。
 *
 * v6（2026-09-09、結果カードの改善）: variant='result'向けに
 * retrospectiveMatches/retrospectiveMismatches（サイトの「データで振り返る」と
 * 同じ✅/⚠️形式の振り返り文）を追加。ピックのハイライトはvariantで意味を
 * 分離した（picks: 先頭ピックに常時ゴールドの「本命」、result: 実際に
 * 的中したピックのみ緑の「的中」、外れたピックは無強調）。「実際の着順」は
 * 地の文からhit有無で色分けした枠付きボックスに格上げした。これらの追加で
 * 増えた縦方向の分だけ、既存要素の余白・フォントサイズを詰めて
 * marginTop:"auto"フッターがキャンバス外に溢れないようにしている。
 */
export function CampaignEntryCard({
  variant = "picks",
  dayLabel,
  headline,
  raceLine,
  heroStat,
  picks = [],
  points = [],
  hit,
  actualResult,
  purchaseAmountYen,
  payoutYen,
  cumulativeNetYen,
  record,
  retrospectiveMatches = [],
  retrospectiveMismatches = [],
}) {
  const { width } = useVideoConfig();
  const scale = width / 1080;
  const padX = 64 * scale;

  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    headline,
    {
      maxWidth: width - padX * 2,
      maxLines: 3,
      fontFamily: FONT,
      fontWeight: 700,
      maxFontSize: 58 * scale,
      minFontSize: 34 * scale,
    },
  );

  const netPositive = (cumulativeNetYen ?? 0) >= 0;

  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        fontFamily: FONT,
        color: WHITE,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* ブランドの主色（ゴールド）を一目で識別できるよう、カード上端に帯を敷く
          （CampaignDataExcerptCardと共通、2026-09-09） */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 8 * scale,
          background: GOLD,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 8 * scale,
          left: 0,
          right: 0,
          bottom: 0,
          padding: `${56 * scale}px ${padX}px`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12 * scale,
            marginBottom: 28 * scale,
          }}
        >
          <div
            style={{
              width: 11 * scale,
              height: 11 * scale,
              borderRadius: "50%",
              background: GOLD,
            }}
          />
          <span style={{ color: GOLD, fontWeight: 700, fontSize: 24 * scale }}>
            龍神レーダー
          </span>
        </div>

        {dayLabel && (
          <div
            style={{
              color: MUTED,
              fontSize: 18 * scale,
              marginBottom: 8 * scale,
            }}
          >
            {dayLabel}
          </div>
        )}

        <div
          style={{
            color: GOLD,
            fontWeight: 700,
            fontSize: headlineFontSize,
            lineHeight: 1.35,
            marginBottom: 32 * scale,
            textShadow: `0 0 30px ${GOLD}44`,
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
              fontSize: 22 * scale,
              marginBottom: 32 * scale,
            }}
          >
            {raceLine}
          </div>
        )}

        {heroStat && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 18 * scale,
              background: `linear-gradient(90deg, ${GOLD}29, ${GOLD}00)`,
              borderLeft: `4px solid ${GOLD}`,
              borderRadius: 6 * scale,
              padding: `${20 * scale}px ${28 * scale}px`,
              marginBottom: 28 * scale,
            }}
          >
            <span
              style={{
                color: GOLD,
                fontSize: 64 * scale,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              {heroStat.value}
            </span>
            <span
              style={{
                color: WHITE,
                fontSize: 20 * scale,
                fontWeight: 700,
                opacity: 0.9,
              }}
            >
              {heroStat.label}
            </span>
          </div>
        )}

        <div
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 8 * scale,
            background:
              variant === "picks"
                ? "rgba(201,162,39,0.15)"
                : hit
                  ? "rgba(16,185,129,0.15)"
                  : "rgba(239,68,68,0.15)",
            color: variant === "picks" ? "#e8c96a" : hit ? SUCCESS : ERROR,
            fontSize: 16 * scale,
            fontWeight: 700,
            padding: `${10 * scale}px ${20 * scale}px`,
            borderRadius: 999,
            marginBottom: 24 * scale,
          }}
        >
          {variant === "picks"
            ? "事前発表・結果はまだ出ていません"
            : hit
              ? "的中"
              : "不的中"}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12 * scale,
            marginBottom: 28 * scale,
          }}
        >
          {picks.map((combo, i) => {
            // 本命（picks[0]）を強調するのはvariant='picks'（事前発表）のときだけ。
            // 結果が出た後に外れた買い目をゴールドで演出すると「外れたのに主役
            // 扱い」に見えてしまうため（2026-09-09、天才デザイナー・天才
            // マーケターレビューで指摘）、resultバリアントでは的中した買い目
            // （あれば）だけをSUCCESS色で示す
            const isTopPick = variant === "picks" && i === 0;
            const isWinningPick =
              variant === "result" && hit && combo === actualResult;
            const highlighted = isTopPick || isWinningPick;
            const highlightColor = isWinningPick ? SUCCESS : GOLD;
            return (
              <div
                key={combo}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16 * scale,
                  background: highlighted
                    ? `linear-gradient(135deg, ${highlightColor}38, ${CARD_BG})`
                    : CARD_BG,
                  border: highlighted
                    ? `1px solid ${highlightColor}`
                    : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12 * scale,
                  padding: `${18 * scale}px ${26 * scale}px`,
                }}
              >
                {(isTopPick || isWinningPick) && (
                  <span
                    style={{
                      color: NAVY,
                      background: highlightColor,
                      fontSize: 15 * scale,
                      fontWeight: 700,
                      padding: `${4 * scale}px ${12 * scale}px`,
                      borderRadius: 999,
                      flex: "none",
                    }}
                  >
                    {isTopPick ? "本命" : "的中"}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 32 * scale,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                  }}
                >
                  {combo}
                </span>
              </div>
            );
          })}
        </div>

        {variant === "result" && actualResult && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: hit
                ? "rgba(16,185,129,0.12)"
                : "rgba(239,68,68,0.12)",
              border: `1px solid ${hit ? SUCCESS : ERROR}55`,
              borderRadius: 10 * scale,
              padding: `${14 * scale}px ${24 * scale}px`,
              marginBottom: 24 * scale,
            }}
          >
            <span
              style={{ fontSize: 16 * scale, color: MUTED, fontWeight: 700 }}
            >
              実際の着順
            </span>
            <span
              style={{
                fontSize: 32 * scale,
                fontWeight: 800,
                letterSpacing: 1.5,
                color: hit ? SUCCESS : ERROR,
              }}
            >
              {actualResult}
            </span>
          </div>
        )}

        {variant === "result" &&
          (retrospectiveMatches.length > 0 ||
            retrospectiveMismatches.length > 0) && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12 * scale,
                marginBottom: 20 * scale,
              }}
            >
              {retrospectiveMatches.length > 0 && (
                <div>
                  <div
                    style={{
                      color: SUCCESS,
                      fontSize: 15 * scale,
                      fontWeight: 700,
                      marginBottom: 6 * scale,
                    }}
                  >
                    ✅ データと整合した点
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      fontSize: 17 * scale,
                      lineHeight: 1.55,
                      color: "#e7ebef",
                    }}
                  >
                    {retrospectiveMatches.map((m) => (
                      <li key={m} style={{ marginBottom: 6 * scale }}>
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {retrospectiveMismatches.length > 0 && (
                <div>
                  <div
                    style={{
                      color: ERROR,
                      fontSize: 15 * scale,
                      fontWeight: 700,
                      marginBottom: 6 * scale,
                    }}
                  >
                    ⚠️ データと違った点
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      fontSize: 17 * scale,
                      lineHeight: 1.55,
                      color: "#e7ebef",
                    }}
                  >
                    {retrospectiveMismatches.map((m) => (
                      <li key={m} style={{ marginBottom: 6 * scale }}>
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

        {variant === "picks" && points.length > 0 && (
          <>
            <div
              style={{
                color: MUTED,
                fontSize: 16 * scale,
                fontWeight: 700,
                marginBottom: 14 * scale,
              }}
            >
              分析ツールで見えたポイント
            </div>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                fontSize: 20 * scale,
                lineHeight: 1.85,
                color: "#e7ebef",
              }}
            >
              {points.map((point) => (
                <li key={point} style={{ marginBottom: 12 * scale }}>
                  {point}
                </li>
              ))}
            </ul>
          </>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${GOLD}4d`,
            paddingTop: 24 * scale,
            marginTop: "auto",
            flex: "none",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 15 * scale,
                color: MUTED,
                marginBottom: 6 * scale,
              }}
            >
              {variant === "picks" ? "購入額" : "払戻"}
            </div>
            <div style={{ fontSize: 28 * scale, fontWeight: 700 }}>
              {variant === "picks"
                ? `${purchaseAmountYen}円`
                : `${payoutYen}円`}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 15 * scale,
                color: MUTED,
                marginBottom: 6 * scale,
              }}
            >
              通算収支
            </div>
            <div
              style={{
                fontSize: 24 * scale,
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
                  fontSize: 15 * scale,
                  color: MUTED,
                  marginBottom: 6 * scale,
                }}
              >
                ここまで
              </div>
              <div style={{ fontSize: 28 * scale, fontWeight: 700 }}>
                {record}
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}
