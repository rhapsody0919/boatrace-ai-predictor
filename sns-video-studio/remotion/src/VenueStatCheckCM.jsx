import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Pop, Logo, NAVY, WHITE, GOLD, FONT } from "./noteVideoShared.jsx";
import { SceneCTA } from "./snsVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

/**
 * 会場データチェック型（第1弾: 1コース勝率の会場差 vs 桐生）
 * — 龍神レーダー X Shorts
 *
 * 2026-09-05新設。sns_topics（venue-feature型、桐生の1コース勝率が全国平均と
 * ほぼ同水準）向け。VenueRankingCM.jsxのTOP5/WORST5ランキング形式は直近の
 * X下書き却下履歴で「会場ごとの比較が意味がない」「当たり前」という指摘が
 * 複数回（2026-08-30〜09-01）繰り返し入っており、かつ本ネタは24会場ランキング
 * ではなく単一会場 vs 全国平均という2値比較のため構造的にも合わない。
 * TriviaCM.jsx（豆知識型、Hook→比較バー→CTAの3幕）のパターンを踏襲しつつ
 * 新規コンポジションとして作成した。
 *
 * データは全てNode.jsから直接races×race_results（直近90日、rank1===1判定）を
 * 集計し直した実測値（2026-09-05取得）。venueParameters.jsのVENUE_1COURSE_WIN_RATE
 * は算出時期が異なる別集計のため使用しない。
 */

const NAVY_DARK = "#081b2e";

// 実データ（2026-09-05、races×race_resultsを直近90日で集計、n=13,505）
const NATIONAL_AVG = 54.8; // 全国平均（24会場合算）
const KIRYU_RATE = 54.7; // 桐生
const MIN_VENUE = { name: "平和島", rate: 39.5 };
const MAX_VENUE = { name: "下関", rate: 63.1 };
const SPREAD = Math.round((MAX_VENUE.rate - MIN_VENUE.rate) * 10) / 10; // 23.6pt

function Category({ children }) {
  return (
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
      会場データ検証
    </div>
  );
}

// --- Scene 1: フック（0-90f, 3s） ---
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 90], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      {/* 背景: 最小・最大会場の実データバー（スプレッドの大きさを視覚化） */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 80,
          padding: "0 160px 300px",
        }}
      >
        {[MIN_VENUE, MAX_VENUE].map((v, i) => {
          const h = interpolate(v.rate, [30, 70], [140, 920]);
          return (
            <div
              key={v.name}
              style={{
                width: 140,
                height: h,
                background: i === 1 ? GOLD : "rgba(255,255,255,0.08)",
                borderRadius: "4px 4px 0 0",
              }}
            />
          );
        })}
      </AbsoluteFill>

      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 50, right: 44 }}>
        <Category />
      </Pop>

      {/* 主役: 24会場の実データ差（スプレッド） */}
      <Pop delay={-10} style={{ position: "absolute", left: -8, top: 290 }}>
        <div
          style={{
            fontSize: 220,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.85,
            textShadow: `0 0 130px ${GOLD}aa`,
          }}
        >
          {SPREAD}pt
        </div>
      </Pop>

      <div style={{ position: "absolute", left: 60, top: 500, right: 60 }}>
        <Pop delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 52,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1.2,
              marginBottom: 18,
            }}
          >
            1号艇の強さ、
            <br />
            会場でこんなに違う
          </div>
        </Pop>
        <Pop delay={-10} style={{ display: "inline-block" }}>
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 30,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            {MIN_VENUE.name}{MIN_VENUE.rate}% 〜 {MAX_VENUE.name}
            {MAX_VENUE.rate}%
          </div>
        </Pop>
      </div>

      {/* 下部フック帯: 桐生への問いかけ（open loop） */}
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
            }}
          >
            じゃあ「桐生」は何%？
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 桐生 vs 全国平均（90-330f, 8s） ---
const COMPARE_BAR_MAX_HEIGHT = 620;
const COMPARE_BAR_MAX_VALUE = 58; // 実データ(54.7/54.8)が0.1pt差の近似値のため、軸上限を値に近づけて余白を圧縮する

function CompareColumn({ label, value, maxValue, isGold, delay }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const targetHeight = (value / maxValue) * COMPARE_BAR_MAX_HEIGHT;
  const h = interpolate(local, [0, 40], [0, targetHeight], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const valueOpacity = interpolate(local, [30, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 260,
      }}
    >
      <div
        style={{
          height: COMPARE_BAR_MAX_HEIGHT + 90,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <span
          style={{
            color: isGold ? GOLD : WHITE,
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 52,
            opacity: valueOpacity,
            marginBottom: 14,
          }}
        >
          {value}%
        </span>
        <div
          style={{
            width: "100%",
            height: h,
            background: isGold ? GOLD : "rgba(212,175,55,0.45)",
            borderRadius: "16px 16px 0 0",
          }}
        />
      </div>
      <div
        style={{
          marginTop: 18,
          color: WHITE,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 34,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SceneCompare() {
  const headline = fitHeadline("桐生 vs 全国平均", {
    maxWidth: 900,
    maxLines: 1,
    fontFamily: FONT,
    fontWeight: 900,
    maxFontSize: 44,
    minFontSize: 30,
  });

  return (
    <AbsoluteFill style={{ background: NAVY_DARK, overflow: "hidden" }}>
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={36} />
      </Pop>

      {/* ヘッダー・比較バー・締め帯を1つのflexカラムでspace-evenly配置し、
          固定pxオフセットの組み合わせで生じていた不自然な余白（frame0確認で発覚）を解消する */}
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-evenly",
          padding: "170px 70px 110px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <Pop delay={0}>
            <div
              style={{
                color: GOLD,
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: headline.fontSize,
                textAlign: "center",
              }}
            >
              {headline.lines.map((line, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i}>{line}</div>
              ))}
            </div>
          </Pop>
          <Pop delay={8}>
            <div
              style={{
                marginTop: 10,
                color: "rgba(248,250,252,0.7)",
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: 24,
                textAlign: "center",
              }}
            >
              1コース勝率・直近90日
            </div>
          </Pop>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 90 }}>
          <CompareColumn
            label="全国平均"
            value={NATIONAL_AVG}
            maxValue={COMPARE_BAR_MAX_VALUE}
            delay={20}
          />
          <CompareColumn
            label="桐生"
            value={KIRYU_RATE}
            maxValue={COMPARE_BAR_MAX_VALUE}
            isGold
            delay={34}
          />
        </div>

        <Pop delay={90}>
          <div
            style={{
              display: "inline-block",
              background: `${GOLD}22`,
              border: `2px solid ${GOLD}`,
              borderRadius: 999,
              padding: "16px 32px",
              color: WHITE,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 32,
              textAlign: "center",
            }}
          >
            差はわずか0.1pt、全国平均とほぼ同じ
          </div>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function VenueStatCheckCM_KiryuFirstCourse() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={90}>
        <SceneHook />
      </Sequence>
      <Sequence from={90} durationInFrames={240}>
        <SceneCompare />
      </Sequence>
      <Sequence from={330} durationInFrames={90}>
        <SceneCTA
          ctaLines={["全24会場のデータ、", "無料で見れる"]}
          subLine="桐生も含めて会場ごとにチェック"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
