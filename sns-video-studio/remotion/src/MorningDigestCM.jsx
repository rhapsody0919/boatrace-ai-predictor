import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT } from "./fonts.js";
import { fitHeadline } from "./textFit.js";

/**
 * 「本日のデータ一覧」型（morning-digest、BOA-402）— 龍神レーダー YouTube Shorts / X
 *
 * 材料は morning_digest_days / morning_digest_rows の2表だけ（ADR-0070）。
 * 制作仕様は docs/operation/sns-pipeline-morning-digest.md。
 *
 * この型の主役は「率そのもの」ではなく **率と会場・グレード平均の差**。
 * 逃げ切り率70%でも、大村（平均約73%）と戸田（平均39.5%）では意味が違う。
 * そのため全ての行で **選手の率（ゴールド）と会場平均（シルバー）の2本バー**を並べる。
 * 数値だけを並べると競合と同じ見え方になり、ADR-0071 の差別化点が消える。
 *
 * 掲載順: 候補は画面の rank（metric_skill_delta 降順）上位から取り、
 * **表示だけ率の降順**にする。どのレースを出すかは画面と一致させる。
 *
 * 用語: 「勝率」は使わない（ボートレースの勝率は着順点の平均であり1着率ではない）。
 * 推定値（metric_predicted）には触れない。AIの予測値はイン崩れ指数だけ。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";
const SILVER = "#9aa3ad";

const CANVAS_WIDTH = 1080;
const HERO_MAX_FONT_SIZE = 150;
const HERO_MIN_FONT_SIZE = 108; // 画面幅1080の10%（Shorts一覧フック強度基準の閾値）

/** フック強度基準（画面幅の10%以上・GOLD/WHITE+900）を満たす主役テキスト */
function fitHero(text, { maxWidth = CANVAS_WIDTH * 0.86, maxLines = 1 } = {}) {
  return fitHeadline(text, {
    maxWidth,
    maxLines,
    fontFamily: FONT,
    fontWeight: 900,
    maxFontSize: HERO_MAX_FONT_SIZE,
    minFontSize: HERO_MIN_FONT_SIZE,
  });
}

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

// ロゴは brand-kit.md のとおり /logo-light.png をそのまま使う。
// 絵文字＋ゴールドの角丸バッジは「独自のロゴバッジを作らない」というルールに反する
// （既存CMの一部にその実装が残っているが、新規制作分では踏襲しない）
function Logo({ size = 44 }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <Img
        src={staticFile("logo-light.png")}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
      <span
        style={{
          color: GOLD,
          fontSize: size * 0.62,
          fontWeight: 700,
          fontFamily: FONT,
          letterSpacing: 1,
        }}
      >
        龍神レーダー
      </span>
    </div>
  );
}

/**
 * 1行。選手の率（ゴールド）と、その会場・グレードの平均（シルバー）を必ず並べる。
 * `baselineLabel` は detail.baselineGrade に対応し、'ALL' なら会場名のみ、
 * それ以外は「G1平均」のようにグレードを添える（画面のラベルと揃える）。
 */
function DigestRow({
  rank,
  venue,
  raceNumber,
  name,
  rate,
  baseline,
  baselineLabel,
  note,
  delay,
  maxRate,
}) {
  return (
    <SlideIn
      delay={delay}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        marginBottom: 20,
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
            marginBottom: 6,
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
            {venue}
            {raceNumber}R {name}
          </span>
          <span
            style={{
              color: GOLD,
              fontSize: 38,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            {rate.toFixed(1)}%
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div
            style={{
              height: 14,
              borderRadius: 7,
              background: "rgba(255,255,255,0.1)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(rate / maxRate) * 100}%`,
                background: GOLD,
                borderRadius: 7,
              }}
            />
          </div>
          <div
            style={{
              height: 14,
              borderRadius: 7,
              background: "rgba(255,255,255,0.1)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(baseline / maxRate) * 100}%`,
                background: SILVER,
                borderRadius: 7,
              }}
            />
          </div>
        </div>
        <span
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 18,
            fontFamily: FONT,
          }}
        >
          {baselineLabel} {baseline.toFixed(1)}%
          {note ? `・${note}` : ""}
        </span>
      </div>
    </SlideIn>
  );
}

/** Scene 1: 注目レース（featured）。主役は率の巨大数値 */
function SceneHook({ featured, dateLabel, venueCount, raceCount }) {
  const heroFit = fitHero(`${featured.rate.toFixed(1)}%`);
  const nameFit = fitHeadline(
    `${featured.venue}${featured.raceNumber}R ${featured.name}`,
    {
      maxWidth: CANVAS_WIDTH * 0.86,
      maxLines: 2,
      fontFamily: FONT,
      fontWeight: 800,
      maxFontSize: 56,
      minFontSize: 34,
    },
  );
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
      }}
    >
      <Pop delay={0} style={{ marginBottom: 18 }}>
        <div
          style={{
            background: GOLD,
            color: NAVY_DARK,
            fontSize: 26,
            fontWeight: 900,
            fontFamily: FONT,
            padding: "8px 22px",
            borderRadius: 999,
          }}
        >
          本日のデータ一覧 {dateLabel}
        </div>
      </Pop>
      <Pop delay={4} style={{ marginBottom: 26 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 26,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          {venueCount}会場{raceCount}レースから今日の注目
        </div>
      </Pop>
      <Pop delay={8} style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: heroFit.fontSize,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 1.05,
            textShadow: `0 0 80px ${GOLD}88`,
            textAlign: "center",
          }}
        >
          {heroFit.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </Pop>
      <Pop delay={14} style={{ marginBottom: 22 }}>
        <div
          style={{
            color: WHITE,
            fontSize: 30,
            fontWeight: 800,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          1コース逃げ切り（全国{featured.sampleSize}走）
        </div>
      </Pop>
      <Pop delay={20} style={{ marginBottom: 26 }}>
        <div
          style={{
            fontSize: nameFit.fontSize,
            fontWeight: 800,
            fontFamily: FONT,
            color: WHITE,
            textAlign: "center",
            lineHeight: 1.25,
          }}
        >
          {nameFit.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </Pop>
      <Pop delay={26}>
        <div
          style={{
            display: "flex",
            gap: 18,
            justifyContent: "center",
          }}
        >
          <Stat label={`${featured.venue}の平均`} value={`${featured.baseline.toFixed(1)}%`} />
          <Stat label="イン崩れ指数" value={`${featured.volatility}%`} />
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

function Stat({ label, value }) {
  return (
    <div
      style={{
        background: NAVY,
        borderRadius: 18,
        padding: "16px 28px",
        textAlign: "center",
        minWidth: 240,
      }}
    >
      <div
        style={{
          color: "rgba(248,250,252,0.6)",
          fontSize: 20,
          fontFamily: FONT,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: SILVER,
          fontSize: 46,
          fontWeight: 900,
          fontFamily: FONT,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Scene 2/3: リスト。見出しは必ず数値付きの断定文にする（フック強度基準） */
function SceneList({ title, headline, rows, legend }) {
  // maxLines=1。2行を許すと「逃げ切り率80」「%超が5レース」のように数値の途中で
  // 割れる（fitHeadline の改行可能位置に % が無いため）。見出し側を短くして1行に収める
  const headlineFit = fitHero(headline, {
    maxWidth: CANVAS_WIDTH * 0.86,
    maxLines: 1,
  });
  const maxRate = Math.max(...rows.map((r) => Math.max(r.rate, r.baseline)));
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 70px",
        justifyContent: "center",
      }}
    >
      <Pop delay={0} style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: headlineFit.fontSize,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 1.15,
            textShadow: `0 0 70px ${GOLD}88`,
          }}
        >
          {headlineFit.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </Pop>
      <Pop delay={8} style={{ marginBottom: 28 }}>
        <div
          style={{
            color: WHITE,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
            opacity: 0.85,
          }}
        >
          {title}
        </div>
      </Pop>
      {rows.map((row, i) => (
        <DigestRow
          key={`${row.venue}${row.raceNumber}${row.name}`}
          rank={i + 1}
          venue={row.venue}
          raceNumber={row.raceNumber}
          name={row.name}
          rate={row.rate}
          baseline={row.baseline}
          baselineLabel={row.baselineLabel}
          note={row.note}
          delay={30 + i * 10}
          maxRate={maxRate}
        />
      ))}
      <Pop delay={30 + rows.length * 10}>
        <div
          style={{
            display: "flex",
            gap: 24,
            justifyContent: "center",
            marginTop: 10,
          }}
        >
          <LegendChip color={GOLD} label={legend.gold} />
          <LegendChip color={SILVER} label={legend.silver} />
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

function LegendChip({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{ width: 28, height: 12, borderRadius: 6, background: color }}
      />
      <span
        style={{
          color: "rgba(248,250,252,0.75)",
          fontSize: 20,
          fontFamily: FONT,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** Scene 4: CTA */
function SceneCTA({ ctaLines, subLine }) {
  const fits = ctaLines.map((line) => fitHero(line));
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
      }}
    >
      <Pop delay={0} style={{ marginBottom: 26 }}>
        <div style={{ textAlign: "center" }}>
          {fits.map((fit, i) => (
            <div
              key={i}
              style={{
                fontSize: fit.fontSize,
                fontWeight: 900,
                fontFamily: FONT,
                color: GOLD,
                lineHeight: 1.15,
                textShadow: `0 0 80px ${GOLD}88`,
              }}
            >
              {fit.lines.map((line, j) => (
                <div key={j}>{line}</div>
              ))}
            </div>
          ))}
        </div>
      </Pop>
      <Pop delay={12} style={{ marginBottom: 30 }}>
        <div
          style={{
            color: WHITE,
            fontSize: 30,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          {subLine}
        </div>
      </Pop>
      <Pop delay={20} style={{ marginBottom: 34 }}>
        <div
          style={{
            background: NAVY,
            borderRadius: 18,
            padding: "18px 34px",
            color: SILVER,
            fontSize: 34,
            fontWeight: 800,
            fontFamily: FONT,
          }}
        >
          boat-ai.jp/today
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={52} />
      </Pop>
    </AbsoluteFill>
  );
}

// --- 実データ（2026-09-25 の morning_digest_days / morning_digest_rows） ---
// 逃げは rank 上位5件を取り、表示だけ率の降順に並べ替えている
const DAY = { dateLabel: "9/25", venueCount: 12, raceCount: 144 };

const FEATURED = {
  venue: "びわこ",
  raceNumber: 10,
  name: "山崎郡",
  rate: 86.79,
  baseline: 52.05,
  sampleSize: 53,
  volatility: 1,
};

const NIGE_ROWS = [
  { venue: "尼崎", raceNumber: 12, name: "大上卓人", rate: 87.5, baseline: 57.74, baselineLabel: "一般戦の平均" },
  { venue: "びわこ", raceNumber: 10, name: "山崎郡", rate: 86.79, baseline: 52.05, baselineLabel: "全グレードの平均" },
  { venue: "常滑", raceNumber: 12, name: "和田拓也", rate: 84.38, baseline: 54.34, baselineLabel: "一般戦の平均" },
  { venue: "若松", raceNumber: 11, name: "宮之原輝紀", rate: 83.72, baseline: 67.59, baselineLabel: "G1の平均" },
  { venue: "若松", raceNumber: 7, name: "廣瀬凜", rate: 80.95, baseline: 67.59, baselineLabel: "G1の平均" },
];

const MAKURI_ROWS = [
  { venue: "福岡", raceNumber: 10, name: "今垣光太郎", rate: 33.33, baseline: 1.02, baselineLabel: "一般戦の平均", note: "18走" },
  { venue: "多摩川", raceNumber: 12, name: "永田啓二", rate: 31.25, baseline: 5.13, baselineLabel: "一般戦の平均", note: "32走" },
];

export function MorningDigestCM() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={120}>
        <SceneHook
          featured={FEATURED}
          dateLabel={DAY.dateLabel}
          venueCount={DAY.venueCount}
          raceCount={DAY.raceCount}
        />
      </Sequence>
      <Sequence from={120} durationInFrames={210}>
        <SceneList
          headline="80%超が5レース"
          title="1コース逃げ切り率70%超（会場平均と並べて表示）"
          rows={NIGE_ROWS}
          legend={{ gold: "この選手", silver: "この会場・グレードの平均" }}
        />
      </Sequence>
      <Sequence from={330} durationInFrames={150}>
        <SceneList
          headline="まくり33.3%"
          title="まくりの全国平均は4〜5%。25%超はまれ"
          rows={MAKURI_ROWS}
          legend={{ gold: "この選手", silver: "この会場・グレードの平均" }}
        />
      </Sequence>
      <Sequence from={480} durationInFrames={150}>
        <SceneCTA
          ctaLines={["本日のデータ一覧", "毎朝公開"]}
          subLine="会場とグレードの平均を並べて掲載"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

/**
 * X用の静止画（1080x1350、4:5）。本文280 weightに収まらない一覧をここに逃がす。
 * 企画カード（CampaignEntryCard）で4:5を採用したのと同じ理由で、主な閲覧環境が
 * スマホのタイムラインのため縦長にする。
 */
export function MorningDigestXCard() {
  const maxRate = Math.max(
    ...NIGE_ROWS.map((r) => Math.max(r.rate, r.baseline)),
  );
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "48px 56px",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            background: GOLD,
            color: NAVY_DARK,
            fontSize: 30,
            fontWeight: 900,
            padding: "8px 22px",
            borderRadius: 999,
          }}
        >
          本日のデータ一覧 {DAY.dateLabel}
        </div>
        <div style={{ color: "rgba(248,250,252,0.7)", fontSize: 24 }}>
          {DAY.venueCount}会場{DAY.raceCount}レース
        </div>
      </div>

      <div
        style={{
          color: GOLD,
          fontSize: 44,
          fontWeight: 900,
          marginBottom: 4,
        }}
      >
        逃げが堅い5レース
      </div>
      <div
        style={{
          color: "rgba(248,250,252,0.7)",
          fontSize: 21,
          marginBottom: 20,
        }}
      >
        1コース逃げ切り率70%超
      </div>

      {NIGE_ROWS.map((row, i) => (
        <StaticRow key={`n${i}`} row={row} rank={i + 1} maxRate={maxRate} />
      ))}

      <div
        style={{
          color: GOLD,
          fontSize: 44,
          fontWeight: 900,
          marginTop: 16,
          marginBottom: 4,
        }}
      >
        まくりが利く2レース
      </div>
      <div
        style={{
          color: "rgba(248,250,252,0.7)",
          fontSize: 21,
          marginBottom: 18,
        }}
      >
        そのコースでのまくり1着率25%超（全国平均は4〜5%）
      </div>
      {MAKURI_ROWS.map((row, i) => (
        <StaticRow key={`m${i}`} row={row} rank={i + 1} maxRate={40} />
      ))}

      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 26,
          marginBottom: 18,
        }}
      >
        <LegendChip color={GOLD} label="この選手" />
        <LegendChip color={SILVER} label="この会場・グレードの平均" />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Logo size={44} />
        <div style={{ color: SILVER, fontSize: 28, fontWeight: 800 }}>
          boat-ai.jp/today
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** 静止画用の1行（アニメーションなし。動画の DigestRow と見た目を揃える） */
function StaticRow({ row, rank, maxRate }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: rank <= 3 ? GOLD : "rgba(255,255,255,0.12)",
          color: rank <= 3 ? NAVY_DARK : WHITE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          fontWeight: 900,
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
            marginBottom: 5,
          }}
        >
          <span style={{ color: WHITE, fontSize: 29, fontWeight: 800 }}>
            {row.venue}
            {row.raceNumber}R {row.name}
          </span>
          <span style={{ color: GOLD, fontSize: 34, fontWeight: 900 }}>
            {row.rate.toFixed(1)}%
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Bar width={(row.rate / maxRate) * 100} color={GOLD} />
          <Bar width={(row.baseline / maxRate) * 100} color={SILVER} />
        </div>
        <span style={{ color: "rgba(248,250,252,0.55)", fontSize: 17 }}>
          {row.baselineLabel} {row.baseline.toFixed(1)}%
          {row.note ? `・${row.note}` : ""}
        </span>
      </div>
    </div>
  );
}

function Bar({ width, color }) {
  return (
    <div
      style={{
        height: 12,
        borderRadius: 6,
        background: "rgba(255,255,255,0.1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${width}%`,
          background: color,
          borderRadius: 6,
        }}
      />
    </div>
  );
}
