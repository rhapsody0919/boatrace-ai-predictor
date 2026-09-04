import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT } from "./fonts.js";

/**
 * 本日のデータ一覧型（第1弾: 本日の好調・不調選手ランキング）— 龍神レーダー TikTok Shorts
 *
 * 2026-08-25: 会場攻略・データ一覧型（恒久データ）とは対になる「日替わり」型として新設。
 * 実データ出典: boat-ai.jp「本日の好調・不調選手ランキング」機能
 * （本日出走する全選手を対象に、現在の全国勝率と約90日前時点を比較したdelta上位10名）。
 * 取得日: 2026-08-25。
 *
 * 注意: デビュー直後・長期休養明けの選手は「90日前勝率0.00%」からの上昇となり、
 * 実質的な調子上昇ではなく初期値バイアスで急上昇ランキングに出やすい
 * （boat-ai.jp本体の注意書きにも明記）。本動画では該当選手（白石有美・出口飛龍）を
 * 除外し、実質的な調子上昇を示す選手のみでTOP5を構成した。
 *
 * カバーデザインは会場攻略型と同じ案A（非対称配置＋色のベタ塗り分割＋下部フック帯）を
 * 「選手」データに適用したもの。日替わりで数値・選手名が変わるため、動画自体もほぼ毎日
 * 作り直す前提の型。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";
const RED = "#f87171";

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const scale = spring({
    frame: local,
    fps: 30,
    config: { damping: 12, mass: 0.5 },
  });
  const opacity = interpolate(local, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `scale(${scale})`, ...style }}>
      {children}
    </div>
  );
}

function SlideIn({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const x = interpolate(local, [0, 12], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(local, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `translateX(${x}px)`, ...style }}>
      {children}
    </div>
  );
}

function Logo({ size = 40 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size / 4,
          background: GOLD,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.55,
        }}
      >
        🐉
      </div>
      <span
        style={{
          color: WHITE,
          fontSize: size * 0.5,
          fontWeight: 900,
          fontFamily: FONT,
          letterSpacing: -1,
        }}
      >
        龍神レーダー
      </span>
    </div>
  );
}

// --- 選手ランキング行 ---
function RacerRow({
  rank,
  name,
  race,
  current,
  past,
  delta,
  delay,
  barColor,
  barRatio,
}) {
  const sign = delta > 0 ? "+" : "";
  return (
    <SlideIn
      delay={delay}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        marginBottom: 22,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: rank <= 3 ? GOLD : "rgba(255,255,255,0.12)",
          color: rank <= 3 ? NAVY_DARK : WHITE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 900,
          fontFamily: FONT,
          flexShrink: 0,
        }}
      >
        {rank}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              color: WHITE,
              fontSize: 32,
              fontWeight: 800,
              fontFamily: FONT,
            }}
          >
            {name}
          </span>
          <span
            style={{
              color: barColor,
              fontSize: 34,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            {sign}
            {delta.toFixed(2)}pt
          </span>
        </div>
        <div
          style={{
            height: 12,
            borderRadius: 6,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${barRatio}%`,
              background: barColor,
              borderRadius: 6,
            }}
          />
        </div>
        <span
          style={{
            color: "rgba(248,250,252,0.5)",
            fontSize: 16,
            fontFamily: FONT,
          }}
        >
          {race}・全国勝率 {past.toFixed(2)} → {current.toFixed(2)}
          （90日前比）
        </span>
      </div>
    </SlideIn>
  );
}

// --- Scene 1: フック（0-75f, 2.5s） ---
// 会場攻略型と同じ案A（非対称配置＋色のベタ塗り分割＋下部フック帯）を選手データに適用
function SceneHook({
  topName,
  topRace,
  deltaLabel,
  hookQuestion,
  subCaption,
  categoryTag,
}) {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 50, right: 44 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${GOLD}`,
            borderRadius: 999,
            padding: "6px 18px",
            color: GOLD,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {categoryTag}
        </div>
      </Pop>

      {/* タイトル: 従来の小さいラベル(fontSize32)を「何の動画か」が最も目立つ
          見出しへ格上げし、元の文言はサブキャプションとして残す（2026-08-31、
          天才デザイナー・天才マーケター議論。ラベルが小さすぎて目立たないという指摘への対応） */}
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 180, left: 40, right: 40 }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 76,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.1,
            textShadow: `0 0 40px ${GOLD}88`,
          }}
        >
          急上昇選手ランキング
        </div>
      </Pop>
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 280, left: 40, right: 40 }}
      >
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 28,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          過去90日間の全国勝率の変化
        </div>
      </Pop>

      {/* 主役: 巨大な変化量。「+1.26」は5文字あり会場攻略型の1〜2文字より
          横幅を取るため、frame=0のはみ出しを避けてfontSizeを抑えている（2026-08-25） */}
      <Pop delay={-10} style={{ position: "absolute", left: 40, top: 400 }}>
        <div
          style={{
            fontSize: 150,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.9,
            textShadow: `0 0 130px ${GOLD}aa`,
          }}
        >
          {deltaLabel}
          <span style={{ fontSize: 60 }}>pt</span>
        </div>
      </Pop>

      {/* 選手名＋レース情報バッジ */}
      <div style={{ position: "absolute", left: 60, top: 780, right: 60 }}>
        <Pop delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 76,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 22,
            }}
          >
            {topName}
          </div>
        </Pop>
        <Pop delay={-10} style={{ display: "inline-block" }}>
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 32,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            {topRace}
          </div>
        </Pop>
      </div>

      {/* 下部フック帯: ベタ塗り・ハードエッジ */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: GOLD,
          padding: "40px 60px 84px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY_DARK,
              fontSize: 46,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
              marginBottom: 10,
            }}
          >
            {hookQuestion}
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: `${NAVY_DARK}cc`,
              fontSize: 26,
              fontWeight: 700,
              fontFamily: FONT,
              textAlign: "center",
            }}
          >
            {subCaption}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 急上昇TOP5（75-263f, 約6.3s） ---
function SceneRising({ data }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 70px",
        justifyContent: "center",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: GOLD,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 30,
          }}
        >
          🔥 本日の急上昇選手 TOP5
        </div>
      </Pop>
      {data.map((row, i) => (
        <RacerRow
          key={row.name}
          rank={i + 1}
          name={row.name}
          race={row.race}
          current={row.current}
          past={row.past}
          delta={row.delta}
          delay={20 + i * 10}
          barColor={GOLD}
          barRatio={(row.delta / data[0].delta) * 100}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: 急下降TOP5（263-450f, 約6.2s） ---
function SceneFalling({ data }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 70px",
        justifyContent: "center",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: RED,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 30,
          }}
        >
          📉 本日の急下降選手 TOP5
        </div>
      </Pop>
      {data.map((row, i) => (
        <RacerRow
          key={row.name}
          rank={i + 1}
          name={row.name}
          race={row.race}
          current={row.current}
          past={row.past}
          delta={row.delta}
          delay={20 + i * 10}
          barColor={RED}
          barRatio={(Math.abs(row.delta) / Math.abs(data[0].delta)) * 100}
        />
      ))}
      <Pop delay={80}>
        <div
          style={{
            color: "rgba(248,250,252,0.5)",
            fontSize: 18,
            fontFamily: FONT,
            marginTop: 10,
          }}
        >
          除外判断の参考データです。単独で判断せず、他の指標と合わせてご確認ください
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（450-600f, 5s） ---
function SceneCTA({ ctaLines, subLine }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
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
            padding: "0 60px",
          }}
        >
          {ctaLines[0]}
          <br />
          {ctaLines[1]}
        </div>
      </Pop>
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
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

// 2026-08-25取得。90日前0.00%からの上昇（新人・長期休養明けバイアス）の選手は除外済み
const RISING_TOP5 = [
  { name: "鈴木成美", race: "三国1R", current: 4.16, past: 2.9, delta: 1.26 },
  { name: "別府昌樹", race: "丸亀1R", current: 4.81, past: 3.59, delta: 1.22 },
  { name: "浜田亜理沙", race: "三国6R", current: 7.0, past: 5.85, delta: 1.15 },
  {
    name: "出口舞有子",
    race: "三国7R",
    current: 5.49,
    past: 4.38,
    delta: 1.11,
  },
  { name: "小林甘寧", race: "津9R", current: 5.34, past: 4.31, delta: 1.03 },
];

const FALLING_TOP5 = [
  { name: "宮本夏樹", race: "福岡5R", current: 4.85, past: 6.22, delta: -1.37 },
  { name: "塩崎優司", race: "若松6R", current: 3.92, past: 5.28, delta: -1.36 },
  { name: "柳瀬興志", race: "徳山2R", current: 4.63, past: 5.69, delta: -1.06 },
  {
    name: "中山翔太",
    race: "尼崎11R",
    current: 6.14,
    past: 7.17,
    delta: -1.03,
  },
  { name: "渡辺豊", race: "芦屋1R", current: 4.16, past: 5.11, delta: -0.95 },
];

export function TodaysRacerFormCM() {
  const top = RISING_TOP5[0];
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          topName={top.name}
          topRace={`${top.race}・全国勝率${top.current.toFixed(2)}`}
          deltaLabel={`+${top.delta.toFixed(2)}`}
          hookQuestion="本日出走の選手で、一番調子が上がっている選手は？"
          subCaption="本日出走する選手の中で、過去90日間の全国勝率の変化を比較"
          categoryTag="本日出走・好調選手"
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneRising data={RISING_TOP5} />
      </Sequence>
      <Sequence from={263} durationInFrames={187}>
        <SceneFalling data={FALLING_TOP5} />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA
          ctaLines={["本日の全ランキング、", "無料で見れる"]}
          subLine="あなたの狙う選手は、上昇中？下降中？"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
