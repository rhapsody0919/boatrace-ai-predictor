import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { NAVY, GOLD, WHITE } from "./noteVideoShared.jsx";

const CARD_BG = "#142842";
const MUTED = "#9aa3ad";
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", "Hiragino Sans", sans-serif';
const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * 企画型SNSパイプライン（docs/design/sns-hub-campaign-pipeline/）の
 * X投稿用カード（静止画像）。2枚目「根拠データカード」。
 *
 * CampaignEntryCard（1枚目）とセットで1投稿に添付する想定。
 * 龍神レーダーは「分析ツール」としてPRする方針のため、買い目を決めた
 * 内部の計算式・スコアは見せず、サイトの分析ツールに実在する項目
 * （データ出走表・展開予測）をそのまま抜粋する構成にしている
 * （ユーザー確認済み、2026-09-09）。
 *
 * @param {{boat_number:number, player_name:string, win_rate:number, motor_2rate:number}[]} boats
 * @param {number[]} pickedBoatNumbers - データ出走表で★を付ける艇番（買い目に含まれる艇）
 * @param {{technique:string, winnerCourse:number, probability:number}[]} turnPredictionTop3 - 展開予測の1着候補（確率降順、最大3件）
 */
export function CampaignDataExcerptCard({
  raceLine,
  boats = [],
  pickedBoatNumbers = [],
  turnPredictionTop3 = [],
}) {
  const { width } = useVideoConfig();
  const scale = width / 1200;
  const pickedSet = new Set(pickedBoatNumbers);

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
          fontSize: 20 * scale,
          fontWeight: 700,
          marginBottom: 4 * scale,
        }}
      >
        {raceLine} データ出走表（抜粋）
      </div>
      <div
        style={{ color: MUTED, fontSize: 13 * scale, marginBottom: 22 * scale }}
      >
        分析ツールで全艇・全項目を確認できます
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 15 * scale,
          marginBottom: 22 * scale,
        }}
      >
        <thead>
          <tr>
            {["艇番", "選手", "勝率", "モーター2連率"].map((label, i) => (
              <th
                key={label}
                style={{
                  textAlign: i === 0 ? "left" : "center",
                  color: MUTED,
                  fontWeight: 700,
                  fontSize: 13 * scale,
                  paddingBottom: 8 * scale,
                  borderBottom: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {boats.map((boat) => {
            const picked = pickedSet.has(boat.boat_number);
            const cellStyle = {
              padding: `${9 * scale}px 0`,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              textAlign: "center",
              color: picked ? GOLD : WHITE,
            };
            return (
              <tr key={boat.boat_number}>
                <td
                  style={{ ...cellStyle, textAlign: "left", fontWeight: 700 }}
                >
                  {boat.boat_number}号艇{picked ? " ★" : ""}
                </td>
                <td style={cellStyle}>{boat.player_name}</td>
                <td style={cellStyle}>{boat.win_rate?.toFixed(2)}</td>
                <td style={cellStyle}>{boat.motor_2rate?.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {turnPredictionTop3.length > 0 && (
        <>
          <div
            style={{
              fontSize: 13 * scale,
              color: MUTED,
              fontWeight: 700,
              marginBottom: 10 * scale,
            }}
          >
            展開予測（1着候補・確率順）
          </div>
          <div
            style={{
              display: "flex",
              gap: 10 * scale,
              marginBottom: 22 * scale,
            }}
          >
            {turnPredictionTop3.map((p, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                style={{
                  flex: 1,
                  background: CARD_BG,
                  borderRadius: 8 * scale,
                  padding: `${12 * scale}px ${10 * scale}px`,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 18 * scale, marginBottom: 4 * scale }}>
                  {MEDALS[i]}
                </div>
                <div style={{ fontSize: 15 * scale, fontWeight: 700 }}>
                  {p.winnerCourse}号艇
                </div>
                <div
                  style={{
                    fontSize: 12 * scale,
                    color: "#cfd6dd",
                    margin: `${2 * scale}px 0`,
                  }}
                >
                  {p.technique}
                </div>
                <div
                  style={{ fontSize: 13 * scale, color: GOLD, fontWeight: 700 }}
                >
                  {Math.round(p.probability * 100)}%
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div
        style={{
          marginTop: "auto",
          paddingTop: 16 * scale,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          fontSize: 13 * scale,
          color: MUTED,
        }}
      >
        このデータは
        <span style={{ color: GOLD, fontWeight: 700 }}>
          龍神レーダーの分析ツール
        </span>
        で毎レース無料で見られます
      </div>
    </AbsoluteFill>
  );
}
