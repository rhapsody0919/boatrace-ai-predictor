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

/**
 * 会場攻略・データ一覧型（第1弾: イン逃げ率ランキング）— 龍神レーダー TikTok/X Shorts
 *
 * 2026-08-23: TikTok実地調査（隣接ジャンル「競馬予想のよ」の分析）を踏まえ新設。
 * 個別レース予想より「会場ごとの体系的な傾向」の方が保存されやすいという知見から、
 * 24会場・全期間データ（のべ約38,600レース、race_results×racesの全件集計）を
 * イン逃げ率で横断ランキング化した。日替わりではなく恒久的に使えるデータのため、
 * 「今日の◯◯」ではなく「そもそも◯◯な会場」という切り口にしている。
 *
 * データ出典: 2026-08-23時点のrace_results全件集計（会場あたり1,300〜1,900レース）。
 * マスコットキャラは3体テスト結果が出るまで未定のため、このバージョンでは未使用。
 * キャラが決まったらSceneHook/SceneCTAにMascotコンポーネントを追加する。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const ACCENT = "#38bdf8";
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

// 実際のサイトロゴ（/logo-light.png、龍の紋章）を使う。絵文字🐉ベースの
// バッジは環境依存でカラフルなイラストとして表示され浮くため不採用
// （2026-09-01、note埋め込み動画側で確立した方針をこちらにも適用。
// docs/reference/brand-kit.md参照。2026-09-02、この修正がTikTok/X用
// 動画群（本ファイルの全コンポジション）に反映されていなかった指摘を受け
// 統一）
function Logo({ size = 40, brandName = "龍神レーダー" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Img
        src={staticFile("logo-light.png")}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
      <span
        style={{
          color: WHITE,
          fontSize: size * 0.5,
          fontWeight: 900,
          fontFamily: FONT,
          letterSpacing: -1,
        }}
      >
        {brandName}
      </span>
    </div>
  );
}

// --- 会場ランキング行 ---
function RankRow({
  rank,
  venue,
  value,
  sample,
  delay,
  barColor,
  barRatio,
  sampleSuffix = "レースを集計",
}) {
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
            marginBottom: 6,
          }}
        >
          <span
            style={{
              color: WHITE,
              fontSize: 34,
              fontWeight: 800,
              fontFamily: FONT,
            }}
          >
            {venue}
          </span>
          <span
            style={{
              color: barColor,
              fontSize: 38,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            {value}
          </span>
        </div>
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
              width: `${barRatio}%`,
              background: barColor,
              borderRadius: 6,
            }}
          />
        </div>
        <span
          style={{
            color: "rgba(248,250,252,0.5)",
            fontSize: 18,
            fontFamily: FONT,
          }}
        >
          {sample}
          {sampleSuffix}
        </span>
      </div>
    </SlideIn>
  );
}

// --- Scene 1: フック（0-75f, 2.5s） ---
// カバー画像（frame=0）としても使われる。2026-08-24、7人パネル議論→ユーザーの
// 複数回の「ダメ出し」を経て、デザイナーエージェントの設計案（案A）で全面刷新。
// 「全要素を均等に大きくする」旧アプローチをやめ、非対称配置で主役（巨大な順位
// 数字）を1つに絞り、色のベタ塗り分割・実データの棒グラフ背景で階層をつける
function SceneHook({
  axisTitle,
  topVenue,
  rateLabel,
  hookQuestion,
  subCaption,
  categoryTag,
  allRates,
  topRateIndex,
  accentColor = GOLD,
  brandName,
  avgLabel = "平均",
  rankLabel = "位",
}) {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const minRate = Math.min(...allRates);
  const maxRate = Math.max(...allRates);
  const avgRate = allRates.reduce((a, b) => a + b, 0) / allRates.length;
  const avgHeight = interpolate(avgRate, [minRate, maxRate], [50, 620]);
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      {/* 実データの可視化: 会場・艇番等のミニバーチャートを背景に敷く。装飾ではなくデータそのもの。
          2026-08-31: 「何についての動画か伝わらない」というユーザー指摘を受け、平均線と
          1位バーの実数値ラベルを追加し、チャート自体を「裏付けデータ」として格上げした */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 7,
          padding: "0 36px 340px",
        }}
      >
        {allRates.map((r, i) => {
          const h = interpolate(r, [minRate, maxRate], [50, 620]);
          const isTop = i === topRateIndex;
          return (
            <div
              key={i}
              style={{
                position: "relative",
                width: 26,
                height: h,
                background: isTop ? accentColor : "rgba(255,255,255,0.08)",
                borderRadius: "4px 4px 0 0",
              }}
            >
              {isTop && (
                <div
                  style={{
                    position: "absolute",
                    top: -46,
                    left: "50%",
                    transform: "translateX(-50%)",
                    color: accentColor,
                    fontSize: 30,
                    fontWeight: 900,
                    fontFamily: FONT,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r}%
                </div>
              )}
            </div>
          );
        })}
      </AbsoluteFill>

      {/* 平均線: 1位の数値がどれだけ突出しているかを視覚的に裏付ける */}
      <div
        style={{
          position: "absolute",
          left: 36,
          right: 36,
          bottom: 340 + avgHeight,
          borderTop: "2px dashed rgba(248,250,252,0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 36,
          bottom: 340 + avgHeight + 8,
          color: "rgba(248,250,252,0.65)",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: FONT,
        }}
      >
        {avgLabel} {avgRate.toFixed(1)}%
      </div>

      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} brandName={brandName} />
      </Pop>

      {/* 見出し: 何についての動画かを最優先で伝える（2026-08-31追加）。
          旧デザインではcategoryTagが右上の極小バッジのみで、軸名（何のランキングか）が
          伝わらないという指摘があったため新設。視線誘導は見出し→1位→チャート裏付けの順 */}
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 150, left: 40, right: 40 }}
      >
        <div
          style={{
            color: accentColor,
            fontSize: 78,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.1,
            textShadow: `0 0 40px ${accentColor}88`,
          }}
        >
          {axisTitle}
        </div>
      </Pop>
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 250, left: 40, right: 40 }}
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
          {categoryTag}
        </div>
      </Pop>

      {/* 主役: 巨大な順位数字＋会場名。1つのグループとして中央寄せに配置する
          （2026-08-31: 左端はみ出しの非対称配置がバランス悪い・右側の余白が目立つ
          というユーザー指摘を受け、中央寄せ＋間隔確保に変更） */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 340,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 44,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div
            style={{
              fontSize: 400,
              fontWeight: 900,
              fontFamily: FONT,
              color: accentColor,
              lineHeight: 0.8,
              textShadow: `0 0 130px ${accentColor}aa`,
            }}
          >
            1
          </div>
          <div
            style={{
              fontSize: 100,
              fontWeight: 900,
              fontFamily: FONT,
              color: accentColor,
              marginBottom: 46,
              marginLeft: 4,
            }}
          >
            {rankLabel}
          </div>
        </div>
        <div style={{ textAlign: "left", marginBottom: 24 }}>
          <div
            style={{
              color: WHITE,
              fontSize: 108,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 18,
            }}
          >
            {topVenue}
          </div>
          <div
            style={{
              display: "inline-block",
              background: accentColor,
              color: NAVY_DARK,
              fontSize: 40,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            {rateLabel}
          </div>
        </div>
      </Pop>

      {/* 下部フック帯: ベタ塗り・ハードエッジで色の塊を作り、疑問形で続きへの動機を作る */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: accentColor,
          padding: "40px 60px 84px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY_DARK,
              fontSize: 52,
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

// --- Scene 1 案B: 対角分割Before/After型（デザイナーエージェント案B、2026-08-24） ---
// TOP1位とWORST1位を斜め境界線で対比させる。「会場でこんなに違う」という
// 動画本編の対比構成そのものをカバーに反映できるのが案Aとの違い
function SceneHookDiagonal({
  topVenue,
  topRateLabel,
  bottomVenue,
  bottomRateLabel,
  diffLabel,
  hookQuestion,
  categoryTag,
  accentColor = GOLD,
}) {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const clip = "polygon(0 0, 62% 0, 38% 100%, 0 100%)";
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `${accentColor}1c`,
          clipPath: clip,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderLeft: `3px solid ${accentColor}`,
          clipPath: clip,
        }}
      />

      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 50, right: 44 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${accentColor}`,
            borderRadius: 999,
            padding: "6px 18px",
            color: accentColor,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {categoryTag}
        </div>
      </Pop>

      <div style={{ position: "absolute", left: 60, top: 620, width: 480 }}>
        <Pop delay={-10}>
          <div
            style={{
              color: accentColor,
              fontSize: 30,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            🏆 1位
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 92,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 18,
            }}
          >
            {topVenue}
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: accentColor,
              fontSize: 56,
              fontWeight: 900,
              fontFamily: FONT,
              whiteSpace: "nowrap",
            }}
          >
            {topRateLabel}
          </div>
        </Pop>
      </div>

      <div
        style={{
          position: "absolute",
          right: 60,
          top: 700,
          width: 360,
          textAlign: "right",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: "rgba(248,250,252,0.4)",
              fontSize: 24,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            24位
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: "rgba(248,250,252,0.5)",
              fontSize: 60,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 14,
            }}
          >
            {bottomVenue}
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: "rgba(248,250,252,0.45)",
              fontSize: 40,
              fontWeight: 900,
              fontFamily: FONT,
              whiteSpace: "nowrap",
            }}
          >
            {bottomRateLabel}
          </div>
        </Pop>
      </div>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          left: "50%",
          top: 900,
          transform: "translateX(-50%)",
        }}
      >
        <div
          style={{
            background: accentColor,
            color: NAVY_DARK,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
            borderRadius: 999,
            padding: "10px 30px",
            whiteSpace: "nowrap",
          }}
        >
          差 {diffLabel}
        </div>
      </Pop>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: accentColor,
          padding: "40px 60px 84px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY_DARK,
              fontSize: 50,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {hookQuestion}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 1 案C: 2値比較（最高 vs 最低）型 ---
// 「◯◯pt」という最大差を主役にし、根拠となる2本の棒グラフを画面中央に配置する。
//
// 2026-09-05: X承認待ち動画で棒グラフが画面左に偏り右側が空白になる不具合が報告された。
// 原因調査の結果、venue-featureパイプライン（docs/operation/sns-pipeline-x.md）は
// masterへコードをコミットしないため（データ登録のみの疎結合Routine）、「2値だけの
// 比較」という形状はSceneHook/SceneHookDiagonalのように使い回される既存コンポーネントが
// 無く、Routineがその都度ゼロから書いていたことが分かった。2026-08-31にSceneHookの
// 非対称配置を個別に中央寄せへ修正した教訓が、レビューされないその場限りのコードには
// 伝播しなかった形。この形状専用の共通コンポーネントとして新設し、中央寄せをコード側で
// 固定する（`docs/reference/brand-kit.md`「グラフ・比較ビジュアルの中央寄せ」参照）。
function SceneHookCompareTwo({
  diffValueLabel,
  headlineLines,
  rangeLabel,
  lowVenue,
  lowValue,
  lowValueLabel,
  highVenue,
  highValue,
  highValueLabel,
  hookQuestion,
  categoryTag,
  accentColor = GOLD,
}) {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const barHeight = (value) =>
    interpolate(
      value,
      [Math.min(lowValue, highValue) * 0.85, Math.max(lowValue, highValue)],
      [70, 560],
    );
  const bars = [
    { venue: lowVenue, value: lowValue, label: lowValueLabel, emphasis: false },
    {
      venue: highVenue,
      value: highValue,
      label: highValueLabel,
      emphasis: true,
    },
  ];

  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 50, right: 44 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${accentColor}`,
            borderRadius: 999,
            padding: "6px 18px",
            color: accentColor,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {categoryTag}
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 160,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 130,
            fontWeight: 900,
            fontFamily: FONT,
            color: accentColor,
            lineHeight: 0.9,
            textShadow: `0 0 130px ${accentColor}aa`,
          }}
        >
          {diffValueLabel}
        </div>
      </Pop>
      <Pop
        delay={-6}
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 340,
          textAlign: "center",
        }}
      >
        {headlineLines.map((line, i) => (
          <div
            key={i}
            style={{
              color: WHITE,
              fontSize: 44,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1.3,
            }}
          >
            {line}
          </div>
        ))}
      </Pop>
      <Pop
        delay={-4}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 470,
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: accentColor,
            color: NAVY_DARK,
            fontSize: 28,
            fontWeight: 900,
            fontFamily: FONT,
            borderRadius: 14,
            padding: "8px 20px",
            whiteSpace: "nowrap",
          }}
        >
          {rangeLabel}
        </div>
      </Pop>

      {/* 2本の比較棒グラフ。flexのjustifyContent:"center"で必ずフレーム中央に配置する
          （左右どちらの値が大きくても、固定left/right pxで置かないことで偏りを防ぐ） */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 660,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 70,
        }}
      >
        {bars.map((bar) => (
          <div
            key={bar.venue}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                color: bar.emphasis ? accentColor : "rgba(248,250,252,0.6)",
                fontSize: 30,
                fontWeight: 900,
                fontFamily: FONT,
                whiteSpace: "nowrap",
                marginBottom: 10,
              }}
            >
              {bar.label}
            </div>
            <div
              style={{
                width: 150,
                height: barHeight(bar.value),
                background: bar.emphasis
                  ? accentColor
                  : "rgba(255,255,255,0.14)",
                borderRadius: "10px 10px 0 0",
              }}
            />
            <div
              style={{
                color: WHITE,
                fontSize: 26,
                fontWeight: 700,
                fontFamily: FONT,
                whiteSpace: "nowrap",
                marginTop: 12,
              }}
            >
              {bar.venue}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: accentColor,
          padding: "40px 60px 84px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY_DARK,
              fontSize: 44,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {hookQuestion}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

export function VenueRankingCM_WinRate_VariantB() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHookDiagonal
          topVenue="尼崎"
          topRateLabel="60.9%"
          bottomVenue="戸田"
          bottomRateLabel="41.6%"
          diffLabel="19.3pt"
          hookQuestion="1号艇の勝率、会場でこんなに違う"
          categoryTag="24会場ランキング"
          accentColor={GOLD}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneTop5
          heading="🏆 1号艇が勝ちやすい会場 TOP5"
          data={WIN_RATE_TOP5}
          barColor={GOLD}
        />
      </Sequence>
      <Sequence from={263} durationInFrames={187}>
        <SceneWorst5
          heading="🌊 1号艇が苦戦する会場は？"
          data={WIN_RATE_WORST5}
          barColor={RED}
        />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA
          ctaLines={["全24会場のデータ、", "無料で見れる"]}
          subLine="あなたが狙う会場は、何位？"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

// イン逃げ率ランキング（2026-08-23、第1弾）のデータ
const NIGE_RATE_TOP5 = [
  { venue: "尼崎", value: "59.2%", sample: "1,838", ratio: 100 },
  { venue: "徳山", value: "58.8%", sample: "1,812", ratio: 99 },
  { venue: "大村", value: "57.6%", sample: "1,642", ratio: 97 },
  { venue: "芦屋", value: "57.2%", sample: "1,608", ratio: 97 },
  { venue: "若松", value: "56.5%", sample: "1,610", ratio: 95 },
];

const NIGE_RATE_WORST5 = [
  { rank: 24, venue: "戸田", value: "39.9%", sample: "1,558", ratio: 67 },
  { rank: 23, venue: "平和島", value: "42.4%", sample: "1,548", ratio: 72 },
  { rank: 22, venue: "江戸川", value: "43.2%", sample: "1,421", ratio: 73 },
  { rank: 21, venue: "桐生", value: "47.3%", sample: "1,677", ratio: 80 },
  { rank: 20, venue: "三国", value: "47.7%", sample: "1,555", ratio: 81 },
];

// 万舟率ランキング（2026-08-24、第2弾）のデータ。全期間集計、TOP1位(江戸川19.1%)を100とした相対比率
const MANSHU_RATE_TOP5 = [
  { venue: "江戸川", value: "19.1%", sample: "1,421", ratio: 100 },
  { venue: "鳴門", value: "18.7%", sample: "1,341", ratio: 98 },
  { venue: "桐生", value: "18.5%", sample: "1,677", ratio: 97 },
  { venue: "三国", value: "18.3%", sample: "1,555", ratio: 96 },
  { venue: "戸田", value: "18.0%", sample: "1,558", ratio: 94 },
];

const MANSHU_RATE_WORST5 = [
  { rank: 24, venue: "福岡", value: "12.4%", sample: "1,521", ratio: 65 },
  { rank: 23, venue: "尼崎", value: "14.3%", sample: "1,838", ratio: 75 },
  { rank: 22, venue: "若松", value: "14.5%", sample: "1,610", ratio: 76 },
  { rank: 21, venue: "下関", value: "14.6%", sample: "1,613", ratio: 76 },
  { rank: 20, venue: "蒲郡", value: "15.0%", sample: "1,749", ratio: 79 },
];

// 1号艇勝率ランキング（2026-09-01、generate-evergreen Routineでデータ再検証・更新）のデータ。
// race_results.rank1===1（1号艇1着）/ 全解決済みレース(is_cancelled/is_no_race除外)、venue_code(1〜24)順、全期間集計。
// 全24会場40,471レースで再計算（2026-08-24試作時の集計より母数が増加）。TOP1位(尼崎60.9%)を100とした相対比率
const WIN_RATE_TOP5 = [
  { venue: "尼崎", value: "60.9%", sample: "1,910", ratio: 100 },
  { venue: "徳山", value: "60.7%", sample: "1,877", ratio: 100 },
  { venue: "下関", value: "60.5%", sample: "1,670", ratio: 99 },
  { venue: "芦屋", value: "60.5%", sample: "1,649", ratio: 99 },
  { venue: "大村", value: "60.4%", sample: "1,654", ratio: 99 },
];

const WIN_RATE_WORST5 = [
  { rank: 24, venue: "戸田", value: "41.6%", sample: "1,559", ratio: 68 },
  { rank: 23, venue: "平和島", value: "43.8%", sample: "1,611", ratio: 72 },
  { rank: 22, venue: "江戸川", value: "46.4%", sample: "1,457", ratio: 76 },
  { rank: 21, venue: "鳴門", value: "49.7%", sample: "1,401", ratio: 82 },
  { rank: 20, venue: "桐生", value: "50.3%", sample: "1,749", ratio: 83 },
];

// SceneHookの背景データバー用。venue_code(1〜24)順、全期間集計。
// 2026-09-01更新: 1号艇勝率は全24会場を再取得(尼崎が1位、index12)。
// イン逃げ率・万舟率はTOP5/WORST5の10件のみのため暫定的に同じ配列を流用
const WIN_RATE_ALL = [
  50.3, 41.6, 46.4, 43.8, 54.8, 53.6, 54.8, 57.5, 56.5, 50.8, 53.6, 58.3, 60.9,
  49.7, 55.6, 54.9, 57.1, 60.7, 60.5, 58.6, 60.5, 59.6, 55.9, 60.4,
];
const WIN_RATE_TOP_INDEX = 12; // 尼崎(venue_code=13)

const NIGE_RATE_ALL = [
  47.3, 39.8, 43.3, 42.3, 52.0, 50.6, 52.9, 54.7, 54.3, 47.9, 51.8, 56.3, 59.2,
  47.8, 53.3, 52.8, 54.3, 58.5, 56.6, 56.2, 57.3, 55.5, 52.7, 57.3,
];
const NIGE_RATE_TOP_INDEX = 12; // 尼崎(venue_code=13)

// 1号艇モーター2連率ランキング（2026-09-01、generate-evergreen Routineでデータ再検証・更新）のデータ。
// races.first_boat_motor_2rateの全期間平均、venue_code(1〜24)順。全24会場41,940レースで再計算
// （2026-08-25試作時の集計より母数が増加）。TOP1位(常滑34.1%)を100とした相対比率
const MOTOR2RATE_TOP5 = [
  { venue: "常滑", value: "34.1%", sample: "1,916", ratio: 100 },
  { venue: "丸亀", value: "34.1%", sample: "1,812", ratio: 100 },
  { venue: "宮島", value: "34.0%", sample: "1,740", ratio: 100 },
  { venue: "唐津", value: "33.6%", sample: "1,824", ratio: 99 },
  { venue: "平和島", value: "33.5%", sample: "1,668", ratio: 98 },
];

const MOTOR2RATE_WORST5 = [
  { rank: 24, venue: "福岡", value: "30.7%", sample: "1,656", ratio: 90 },
  { rank: 23, venue: "鳴門", value: "31.6%", sample: "1,440", ratio: 93 },
  { rank: 22, venue: "津", value: "31.9%", sample: "1,617", ratio: 94 },
  { rank: 21, venue: "住之江", value: "31.9%", sample: "1,512", ratio: 94 },
  { rank: 20, venue: "芦屋", value: "31.9%", sample: "1,716", ratio: 94 },
];

const MOTOR2RATE_ALL = [
  32.5, 32.3, 32.1, 33.5, 32.3, 32.3, 32.3, 34.1, 31.9, 32.1, 32.0, 31.9, 32.2,
  31.6, 34.1, 32.7, 34.0, 32.2, 32.3, 32.6, 31.9, 30.7, 33.6, 32.3,
];
const MOTOR2RATE_TOP_INDEX = 7; // 常滑(venue_code=8)

// VenueRankingCM（イン逃げ率ランキング、第1弾）の英語版（2026-08-31、translate action）。
// ビジュアル・データはJA版と同一、テキストのみ翻訳（venue名はdocs/reference/i18n-glossary.md準拠）。
// このパイプラインの動画は元々ナレーション無し（BGMのみ）のため、字幕＝画面焼き込みテキストの翻訳が全て
const NIGE_RATE_TOP5_EN = [
  { venue: "Amagasaki", value: "59.2%", sample: "1,838", ratio: 100 },
  { venue: "Tokuyama", value: "58.8%", sample: "1,812", ratio: 99 },
  { venue: "Omura", value: "57.6%", sample: "1,642", ratio: 97 },
  { venue: "Ashiya", value: "57.2%", sample: "1,608", ratio: 97 },
  { venue: "Wakamatsu", value: "56.5%", sample: "1,610", ratio: 95 },
];

const NIGE_RATE_WORST5_EN = [
  { rank: 24, venue: "Toda", value: "39.9%", sample: "1,558", ratio: 67 },
  { rank: 23, venue: "Heiwajima", value: "42.4%", sample: "1,548", ratio: 72 },
  { rank: 22, venue: "Edogawa", value: "43.2%", sample: "1,421", ratio: 73 },
  { rank: 21, venue: "Kiryu", value: "47.3%", sample: "1,677", ratio: 80 },
  { rank: 20, venue: "Mikuni", value: "47.7%", sample: "1,555", ratio: 81 },
];

export function VenueRankingCM_EN() {
  return (
    <VenueRankingTemplate
      topVenue="Amagasaki"
      axisTitle="Nige (Wire-to-Wire) Rate"
      rateLabel="Nige rate 59.2%"
      hookQuestion="Which venue makes wire-to-wire wins easiest?"
      subCaption="24 venues · 38,600 races analyzed"
      categoryTag="24-Venue Ranking"
      allRates={NIGE_RATE_ALL}
      topRateIndex={NIGE_RATE_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="🚤 Top 5 venues by Nige rate"
      top5Data={NIGE_RATE_TOP5_EN}
      worst5Heading="🌊 Where wire-to-wire is hardest to pull off"
      worst5Data={NIGE_RATE_WORST5_EN}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["Full 24-venue data,", "free to view"]}
      subLine="Where does your venue rank?"
      sampleSuffix=" races analyzed"
      brandName="Ryujin Radar"
      avgLabel="Avg"
      rankLabel="st"
    />
  );
}

// --- Scene 2: TOP5（75-263f, 約6.3s） ---
function SceneTop5({ heading, data, barColor, sampleSuffix }) {
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
            color: barColor,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 30,
          }}
        >
          {heading}
        </div>
      </Pop>
      {data.map((r, i) => (
        <RankRow
          key={r.venue}
          rank={i + 1}
          venue={r.venue}
          value={r.value}
          sample={r.sample}
          barRatio={r.ratio}
          barColor={barColor}
          delay={10 + i * 8}
          sampleSuffix={sampleSuffix}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: ワースト5（263-450f, 約6.3s） ---
// headingColorは既定で従来の水色を維持（既存呼び出し元との互換性維持のため）。
// rankが1〜5の連番でない任意の実データ（例: 23位・24位）も表示できる
function SceneWorst5({
  heading,
  data,
  barColor,
  sampleSuffix,
  headingColor = "#7dd3fc",
}) {
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
            color: headingColor,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 30,
          }}
        >
          {heading}
        </div>
      </Pop>
      {data.map((r, i) => (
        <RankRow
          key={r.venue}
          rank={r.rank}
          venue={r.venue}
          value={r.value}
          sample={r.sample}
          barRatio={r.ratio}
          barColor={barColor}
          delay={10 + i * 8}
          sampleSuffix={sampleSuffix}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（450-600f, 5s） ---
function SceneCTA({ ctaLines, subLine, brandName }) {
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
        <Logo size={48} brandName={brandName} />
      </Pop>
      <Pop delay={34} style={{ marginTop: 14 }}>
        <div
          style={{
            color: ACCENT,
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

// 共通テンプレート。会場攻略・データ一覧型は指標軸だけ差し替えて量産する設計
function VenueRankingTemplate({
  axisTitle,
  topVenue,
  rateLabel,
  hookQuestion,
  subCaption,
  categoryTag,
  allRates,
  topRateIndex,
  accentColor,
  top5Heading,
  top5Data,
  worst5Heading,
  worst5Data,
  barColorTop,
  barColorWorst,
  ctaLines,
  subLine,
  sampleSuffix,
  brandName,
  avgLabel,
  rankLabel,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          axisTitle={axisTitle}
          topVenue={topVenue}
          rateLabel={rateLabel}
          hookQuestion={hookQuestion}
          subCaption={subCaption}
          categoryTag={categoryTag}
          allRates={allRates}
          topRateIndex={topRateIndex}
          accentColor={accentColor}
          brandName={brandName}
          avgLabel={avgLabel}
          rankLabel={rankLabel}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneTop5
          heading={top5Heading}
          data={top5Data}
          barColor={barColorTop}
          sampleSuffix={sampleSuffix}
        />
      </Sequence>
      <Sequence from={263} durationInFrames={187}>
        <SceneWorst5
          heading={worst5Heading}
          data={worst5Data}
          barColor={barColorWorst}
          sampleSuffix={sampleSuffix}
        />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA ctaLines={ctaLines} subLine={subLine} brandName={brandName} />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} loop />
    </AbsoluteFill>
  );
}

// 万舟率のみ全24会場データが未取得のため、TOP5/WORST5の10件を暫定的に流用
const MANSHU_RATE_ALL = [
  19.1, 18.7, 18.5, 18.3, 18.0, 15.0, 14.6, 14.5, 14.3, 12.4,
];
const MANSHU_TOP_INDEX = 0; // 江戸川

export function VenueRankingCM() {
  return (
    <VenueRankingTemplate
      topVenue="尼崎"
      axisTitle="イン逃げ率ランキング"
      rateLabel="イン逃げ率 59.2%"
      hookQuestion="イン逃げが決まりやすい会場は？"
      subCaption="24会場・38,600レースで検証"
      categoryTag="24会場ランキング"
      allRates={NIGE_RATE_ALL}
      topRateIndex={NIGE_RATE_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="🚤 イン逃げ率が高い会場 TOP5"
      top5Data={NIGE_RATE_TOP5}
      worst5Heading="🌊 逃げが決まりにくい会場は？"
      worst5Data={NIGE_RATE_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

export function VenueRankingCM_Manshu() {
  return (
    <VenueRankingTemplate
      topVenue="江戸川"
      axisTitle="万舟率ランキング"
      rateLabel="万舟率 19.1%"
      hookQuestion="万舟が出やすい会場は？"
      subCaption="24会場・38,600レースで検証"
      categoryTag="24会場ランキング"
      allRates={MANSHU_RATE_ALL}
      topRateIndex={MANSHU_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="💰 万舟率が高い会場 TOP5"
      top5Data={MANSHU_RATE_TOP5}
      worst5Heading="🎯 万舟が出にくい会場は？"
      worst5Data={MANSHU_RATE_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

// VenueRankingCM_Manshuの英語版（2026-08-31、translate action）。
// ビジュアル・データはJA版と同一、テキストのみ翻訳（venue名はdocs/reference/i18n-glossary.md準拠）。
// 「万舟」（払戻金が1万円を超える高配当）は文脈で伝わるよう "big payout" と訳した
const MANSHU_RATE_TOP5_EN = [
  { venue: "Edogawa", value: "19.1%", sample: "1,421", ratio: 100 },
  { venue: "Naruto", value: "18.7%", sample: "1,341", ratio: 98 },
  { venue: "Kiryu", value: "18.5%", sample: "1,677", ratio: 97 },
  { venue: "Mikuni", value: "18.3%", sample: "1,555", ratio: 96 },
  { venue: "Toda", value: "18.0%", sample: "1,558", ratio: 94 },
];

const MANSHU_RATE_WORST5_EN = [
  { rank: 24, venue: "Fukuoka", value: "12.4%", sample: "1,521", ratio: 65 },
  { rank: 23, venue: "Amagasaki", value: "14.3%", sample: "1,838", ratio: 75 },
  { rank: 22, venue: "Wakamatsu", value: "14.5%", sample: "1,610", ratio: 76 },
  {
    rank: 21,
    venue: "Shimonoseki",
    value: "14.6%",
    sample: "1,613",
    ratio: 76,
  },
  { rank: 20, venue: "Gamagori", value: "15.0%", sample: "1,749", ratio: 79 },
];

export function VenueRankingCM_Manshu_EN() {
  return (
    <VenueRankingTemplate
      topVenue="Edogawa"
      axisTitle="Big-Payout Rate Ranking"
      rateLabel="Big-payout rate 19.1%"
      hookQuestion="Which venue pays out big most often?"
      subCaption="24 venues · 38,600 races analyzed"
      categoryTag="24-Venue Ranking"
      allRates={MANSHU_RATE_ALL}
      topRateIndex={MANSHU_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="💰 Top 5 venues by big-payout rate"
      top5Data={MANSHU_RATE_TOP5_EN}
      worst5Heading="🎯 Where big payouts are rare"
      worst5Data={MANSHU_RATE_WORST5_EN}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["Full 24-venue data,", "free to view"]}
      subLine="Where does your venue rank?"
      sampleSuffix=" races analyzed"
      brandName="Ryujin Radar"
      avgLabel="Avg"
      rankLabel="st"
    />
  );
}

// VenueRankingCM_Manshuの英語版・バリアントB（2026-08-31、translate action）。
// 別のJA下書き(content_group_id 8ca1fd46-4332-4d18-b179-2a8af924382e、draftId d545faa1)の
// 承認を受けたtranslate実行が、同時刻に別のJA下書き(draftId 621650d6)のtranslate実行と
// 競合し、先に上のVenueRankingCM_Manshu_ENがmasterへpushされていたため、名前衝突を避けて
// バリアントBとして追加した。文言はVenueRankingCM_Manshu_ENと同義（データ・レイアウトは同一）。
// venue名はdocs/reference/i18n-glossary.md準拠
const MANSHU_RATE_TOP5_EN_B = [
  { venue: "Edogawa", value: "19.1%", sample: "1,421", ratio: 100 },
  { venue: "Naruto", value: "18.7%", sample: "1,341", ratio: 98 },
  { venue: "Kiryu", value: "18.5%", sample: "1,677", ratio: 97 },
  { venue: "Mikuni", value: "18.3%", sample: "1,555", ratio: 96 },
  { venue: "Toda", value: "18.0%", sample: "1,558", ratio: 94 },
];

const MANSHU_RATE_WORST5_EN_B = [
  { rank: 24, venue: "Fukuoka", value: "12.4%", sample: "1,521", ratio: 65 },
  { rank: 23, venue: "Amagasaki", value: "14.3%", sample: "1,838", ratio: 75 },
  { rank: 22, venue: "Wakamatsu", value: "14.5%", sample: "1,610", ratio: 76 },
  {
    rank: 21,
    venue: "Shimonoseki",
    value: "14.6%",
    sample: "1,613",
    ratio: 76,
  },
  { rank: 20, venue: "Gamagori", value: "15.0%", sample: "1,749", ratio: 79 },
];

export function VenueRankingCM_Manshu_EN_VariantB() {
  return (
    <VenueRankingTemplate
      topVenue="Edogawa"
      axisTitle="Big-Payout Rate"
      rateLabel="Big-payout rate 19.1%"
      hookQuestion="Which venue throws the most big payouts?"
      subCaption="24 venues · 38,600 races analyzed"
      categoryTag="24-Venue Ranking"
      allRates={MANSHU_RATE_ALL}
      topRateIndex={MANSHU_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="💰 Top 5 venues for big payouts"
      top5Data={MANSHU_RATE_TOP5_EN_B}
      worst5Heading="🎯 Where big payouts are rare"
      worst5Data={MANSHU_RATE_WORST5_EN_B}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["Full 24-venue data,", "free to view"]}
      subLine="Where does your venue rank?"
      sampleSuffix=" races analyzed"
      brandName="Ryujin Radar"
      avgLabel="Avg"
      rankLabel="st"
    />
  );
}

// 2026-08-24: 新カバー方針（デザイナーエージェント案A: 非対称巨大順位数字＋
// 実データ棒グラフ背景＋下部フック帯）の第1号
export function VenueRankingCM_WinRate() {
  return (
    <VenueRankingTemplate
      topVenue="尼崎"
      axisTitle="1号艇勝率ランキング"
      rateLabel="1号艇 勝率 61.1%"
      hookQuestion="1号艇が勝ちやすい会場は？"
      subCaption="24会場・38,600レースで検証"
      categoryTag="24会場ランキング"
      allRates={WIN_RATE_ALL}
      topRateIndex={WIN_RATE_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="🏆 1号艇が勝ちやすい会場 TOP5"
      top5Data={WIN_RATE_TOP5}
      worst5Heading="🌊 1号艇が苦戦する会場は？"
      worst5Data={WIN_RATE_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

export function VenueRankingCM_Motor2Rate() {
  return (
    <VenueRankingTemplate
      topVenue="常滑"
      axisTitle="モーター2連率ランキング"
      rateLabel="モーター2連率 34.1%"
      hookQuestion="モーターが強い会場は？"
      subCaption="24会場・約41,900レースで検証"
      categoryTag="24会場ランキング"
      allRates={MOTOR2RATE_ALL}
      topRateIndex={MOTOR2RATE_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="⚙️ モーター2連率が高い会場 TOP5"
      top5Data={MOTOR2RATE_TOP5}
      worst5Heading="🌊 モーターが弱い会場は？"
      worst5Data={MOTOR2RATE_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

// 1号艇・最速スタート時勝率ランキング（2026-08-27、第6弾）のデータ。
// top_start_stats（boat_number=1、race_countで日次バッチ集計）の
// win_rate_when_top_start、サンプル数(top_start_count)20以上でフィルタ、venue_code(1〜24)順。
// TOP1位(尼崎82.83%)を100とした相対比率
const TOPSTART_TOP5 = [
  { venue: "尼崎", value: "82.8%", sample: "99", ratio: 100 },
  { venue: "住之江", value: "82.8%", sample: "64", ratio: 100 },
  { venue: "常滑", value: "80.4%", sample: "199", ratio: 97 },
  { venue: "宮島", value: "80.3%", sample: "117", ratio: 97 },
  { venue: "福岡", value: "79.4%", sample: "136", ratio: 96 },
];

const TOPSTART_WORST5 = [
  { rank: 24, venue: "平和島", value: "59.1%", sample: "115", ratio: 71 },
  { rank: 23, venue: "三国", value: "61.9%", sample: "147", ratio: 75 },
  { rank: 22, venue: "江戸川", value: "63.5%", sample: "156", ratio: 77 },
  { rank: 21, venue: "児島", value: "67.0%", sample: "100", ratio: 81 },
  { rank: 20, venue: "戸田", value: "67.9%", sample: "109", ratio: 82 },
];

const TOPSTART_ALL = [
  72.83, 67.89, 63.46, 59.13, 75.45, 73.55, 75.82, 80.4, 71.72, 61.9, 70.18,
  82.81, 82.83, 74.16, 76.09, 67.0, 80.34, 75.78, 78.36, 70.39, 79.17, 79.41,
  70.83, 72.3,
];
const TOPSTART_TOP_INDEX = 12; // 尼崎(venue_code=13)

export function VenueRankingCM_TopStart() {
  return (
    <VenueRankingTemplate
      topVenue="尼崎"
      axisTitle="最速スタート勝率ランキング"
      rateLabel="最速スタート勝率 82.8%"
      hookQuestion="スタートで先手を取ったら、一番勝てる会場は？"
      subCaption="1号艇・24会場・サンプル計2,720走で検証"
      categoryTag="24会場ランキング"
      allRates={TOPSTART_ALL}
      topRateIndex={TOPSTART_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="🚀 最速スタート勝率が高い会場 TOP5"
      top5Data={TOPSTART_TOP5}
      worst5Heading="🌊 スタートで先手を取っても油断できない会場は？"
      worst5Data={TOPSTART_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

// VenueRankingCM_TopStartの英語版（2026-08-31、translate action初回実行）。
// ビジュアル・データはJA版と同一、テキストのみ翻訳（venue名はdocs/reference/i18n-glossary.md準拠）。
// このパイプラインの動画は元々ナレーション無し（BGMのみ）のため、字幕＝画面焼き込みテキストの翻訳が全て
const TOPSTART_TOP5_EN = [
  { venue: "Amagasaki", value: "82.8%", sample: "99", ratio: 100 },
  { venue: "Suminoe", value: "82.8%", sample: "64", ratio: 100 },
  { venue: "Tokoname", value: "80.4%", sample: "199", ratio: 97 },
  { venue: "Miyajima", value: "80.3%", sample: "117", ratio: 97 },
  { venue: "Fukuoka", value: "79.4%", sample: "136", ratio: 96 },
];

const TOPSTART_WORST5_EN = [
  { rank: 24, venue: "Heiwajima", value: "59.1%", sample: "115", ratio: 71 },
  { rank: 23, venue: "Mikuni", value: "61.9%", sample: "147", ratio: 75 },
  { rank: 22, venue: "Edogawa", value: "63.5%", sample: "156", ratio: 77 },
  { rank: 21, venue: "Kojima", value: "67.0%", sample: "100", ratio: 81 },
  { rank: 20, venue: "Toda", value: "67.9%", sample: "109", ratio: 82 },
];

export function VenueRankingCM_TopStart_EN() {
  return (
    <VenueRankingTemplate
      topVenue="Amagasaki"
      axisTitle="Fastest-Start Win Rate"
      rateLabel="Fastest-start win rate 82.8%"
      hookQuestion="Which venue rewards a fast start the most?"
      subCaption="Boat 1 · 24 venues · 2,720 starts analyzed"
      categoryTag="24-Venue Ranking"
      allRates={TOPSTART_ALL}
      topRateIndex={TOPSTART_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="🚀 Top 5 venues by fastest-start win rate"
      top5Data={TOPSTART_TOP5_EN}
      worst5Heading="🌊 Where a fast start still isn't safe"
      worst5Data={TOPSTART_WORST5_EN}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["Full 24-venue data,", "free to view"]}
      subLine="Where does your venue rank?"
      sampleSuffix=" races analyzed"
      brandName="Ryujin Radar"
      avgLabel="Avg"
      rankLabel="st"
    />
  );
}

// 1号艇・展示タイム最速時勝率ランキング（2026-08-27、第7弾）のデータ。
// exhibition_time_top_stats（boat_number=1）のwin_rate_when_fastest、
// サンプル数(fastest_count)20以上でフィルタ、venue_code(1〜24)順。
// TOP1位(徳山72.44%)を100とした相対比率
const EXTIME_TOP5 = [
  { venue: "徳山", value: "72.4%", sample: "127", ratio: 100 },
  { venue: "常滑", value: "71.2%", sample: "146", ratio: 98 },
  { venue: "びわこ", value: "70.9%", sample: "127", ratio: 98 },
  { venue: "丸亀", value: "68.4%", sample: "114", ratio: 94 },
  { venue: "福岡", value: "68.0%", sample: "128", ratio: 94 },
];

const EXTIME_WORST5 = [
  { rank: 24, venue: "戸田", value: "45.4%", sample: "163", ratio: 63 },
  { rank: 23, venue: "江戸川", value: "47.2%", sample: "72", ratio: 65 },
  { rank: 22, venue: "平和島", value: "49.0%", sample: "96", ratio: 68 },
  { rank: 21, venue: "鳴門", value: "56.8%", sample: "132", ratio: 78 },
  { rank: 20, venue: "三国", value: "60.2%", sample: "113", ratio: 83 },
];

const EXTIME_ALL = [
  60.91, 45.4, 47.22, 48.96, 62.66, 64.94, 62.16, 71.23, 67.2, 60.18, 70.87,
  67.23, 63.01, 56.82, 68.42, 66.95, 67.52, 72.44, 63.64, 60.9, 65.35, 67.97,
  62.68, 67.94,
];
const EXTIME_TOP_INDEX = 17; // 徳山(venue_code=18)

export function VenueRankingCM_ExTime() {
  return (
    <VenueRankingTemplate
      topVenue="徳山"
      axisTitle="展示タイム別勝率ランキング"
      rateLabel="展示最速時の勝率 72.4%"
      hookQuestion="展示タイムが一番当てになる会場は？"
      subCaption="1号艇・24会場・サンプル計3,090走で検証"
      categoryTag="24会場ランキング"
      allRates={EXTIME_ALL}
      topRateIndex={EXTIME_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="⏱️ 展示最速→勝率が高い会場 TOP5"
      top5Data={EXTIME_TOP5}
      worst5Heading="🌊 展示タイムが当てにならない会場は？"
      worst5Data={EXTIME_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

// 江戸川・1号艇が負ける時の決まり手（2026-08-27、第8弾）のデータ。
// losing_technique_stats（venue_code=3、boat_number=1、過去90日集計）。
// 「決まり手データ」（江戸川1号艇の逃げ率93.61%＝勝つときの型）の裏返しとして、
// 負けるときはどの型にやられているかを見せる対比構成。TOP1位(まくり37.64%)を100とした相対比率
const EDOGAWA_LOSING_TOP5 = [
  { venue: "まくり", value: "37.6%", sample: "102/271", ratio: 100 },
  { venue: "差し", value: "28.0%", sample: "76/271", ratio: 75 },
  { venue: "まくり差し", value: "21.4%", sample: "58/271", ratio: 57 },
  { venue: "抜き", value: "11.4%", sample: "31/271", ratio: 30 },
  { venue: "恵まれ", value: "1.5%", sample: "4/271", ratio: 4 },
];
const EDOGAWA_LOSING_ALL = [37.64, 28.04, 21.4, 11.44, 1.48];

export function VenueRankingCM_EdogawaLosing() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          topVenue="まくり"
          axisTitle="江戸川 負け決まり手ランキング"
          rateLabel="負け決まり手 37.6%"
          hookQuestion="江戸川で1号艇が負けるとしたら、何で負ける？"
          subCaption="1号艇・過去90日271敗で検証"
          categoryTag="決まり手データ"
          allRates={EDOGAWA_LOSING_ALL}
          topRateIndex={0}
          accentColor={GOLD}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneTop5
          heading="🎯 江戸川・1号艇の負け決まり手 TOP5"
          data={EDOGAWA_LOSING_TOP5}
          barColor={GOLD}
        />
      </Sequence>
      <Sequence from={263} durationInFrames={150}>
        <SceneCTA
          ctaLines={["江戸川1号艇の逃げ率も、", "負け方も、無料で見れる"]}
          subLine="勝つときの型は逃げ率93.61%（別データ）"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

// 江戸川・1号艇「逃げ」決まり手構成比（sns-topic-gate、2026-09-05）のデータ。
// winning_technique_stats（boat_number=1、winning_technique=逃げ、直近90日）。
// 江戸川91.24%は全国平均95.24%より4.0pt低く、24会場中最下位（全国ワースト）。
// 単一会場と全国平均の2値比較のフックのため、SceneHookCompareTwo（未使用のまま
// 用意されていた再利用コンポーネント）を初めて採用する（sns-pipeline-x.md「3.」参照）。
const EDOGAWA_NIGE_WORST5 = [
  { rank: 24, venue: "江戸川", value: "91.2%", sample: "177/194", ratio: 94 },
  { rank: 23, venue: "浜名湖", value: "91.9%", sample: "305/332", ratio: 94 },
  { rank: 22, venue: "福岡", value: "92.8%", sample: "311/335", ratio: 95 },
  { rank: 21, venue: "下関", value: "93.0%", sample: "373/401", ratio: 95 },
  { rank: 20, venue: "大村", value: "93.7%", sample: "314/335", ratio: 96 },
];

export function VenueRankingCM_EdogawaNige() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHookCompareTwo
          diffValueLabel="-4.0pt"
          headlineLines={["江戸川の1号艇、", "「逃げ」が決まりにくい？"]}
          rangeLabel="全国ワースト（24会場中24位）"
          lowVenue="江戸川"
          lowValue={91.2}
          lowValueLabel="91.2%"
          highVenue="全国平均"
          highValue={95.2}
          highValueLabel="95.2%"
          hookQuestion="1号艇の「逃げ」決まり手比率、会場でこんなに差がある"
          categoryTag="決まり手データ"
          accentColor={GOLD}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneWorst5
          heading="🌊 1号艇「逃げ」が決まりにくい会場 WORST5"
          data={EDOGAWA_NIGE_WORST5}
          barColor={RED}
        />
      </Sequence>
      <Sequence from={263} durationInFrames={150}>
        <SceneCTA
          ctaLines={["会場ごとの決まり手データ、", "無料で見れる"]}
          subLine="あなたの地元は、何%だと思う？"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} loop />
    </AbsoluteFill>
  );
}

// 1号艇3連率（3着以内率）ランキング（2026-08-27、第9弾）のデータ。
// race_results×racesの全件集計（rank1/rank2/rank3のいずれかが1号艇か）、venue_code(1〜24)順。
// モーター2連率ランキング（機材の抽選由来で会場差が3.4pt程度しか無く実質ノイズだったため不採用）の
// 代わりに採用。こちらは実際のレース結果に基づく指標で、会場差が14.8ptと明確に存在する
const TOP3RATE_TOP5 = [
  { venue: "下関", value: "86.4%", sample: "1,634", ratio: 100 },
  { venue: "大村", value: "85.4%", sample: "1,654", ratio: 99 },
  { venue: "若松", value: "84.9%", sample: "1,648", ratio: 98 },
  { venue: "徳山", value: "84.7%", sample: "1,848", ratio: 98 },
  { venue: "尼崎", value: "84.7%", sample: "1,874", ratio: 98 },
];

const TOP3RATE_WORST5 = [
  { rank: 24, venue: "戸田", value: "71.6%", sample: "1,559", ratio: 83 },
  { rank: 23, venue: "平和島", value: "74.7%", sample: "1,551", ratio: 86 },
  { rank: 22, venue: "鳴門", value: "76.0%", sample: "1,353", ratio: 88 },
  { rank: 21, venue: "江戸川", value: "77.5%", sample: "1,457", ratio: 90 },
  { rank: 20, venue: "三国", value: "77.5%", sample: "1,591", ratio: 90 },
];

const TOP3RATE_ALL = [
  77.7, 71.6, 77.5, 74.7, 78.8, 78.7, 80.8, 81.0, 82.0, 77.5, 79.9, 83.5, 84.7,
  76.0, 81.7, 81.1, 81.6, 84.7, 86.4, 84.9, 82.9, 83.5, 83.1, 85.4,
];
const TOP3RATE_TOP_INDEX = 18; // 下関(venue_code=19)

export function VenueRankingCM_Top3Rate() {
  return (
    <VenueRankingTemplate
      topVenue="下関"
      axisTitle="1号艇3連率ランキング"
      rateLabel="1号艇3連率 86.4%"
      hookQuestion="1号艇が3着以内に踏みとどまりやすい会場は？"
      subCaption="24会場・のべ約39,600レースで検証"
      categoryTag="24会場ランキング"
      allRates={TOP3RATE_ALL}
      topRateIndex={TOP3RATE_TOP_INDEX}
      accentColor={GOLD}
      top5Heading="🛟 1号艇の3連率が高い会場 TOP5"
      top5Data={TOP3RATE_TOP5}
      worst5Heading="🌊 1号艇が飛ばされやすい会場は？"
      worst5Data={TOP3RATE_WORST5}
      barColorTop={GOLD}
      barColorWorst={RED}
      ctaLines={["全24会場のデータ、", "無料で見れる"]}
      subLine="あなたが狙う会場は、何位？"
    />
  );
}

// 汎用「小規模ランキング型」テンプレート（2026-08-27追加）。24会場ランキングと違い
// 艇番別（6項目）・決まり手別（6項目）等、少数項目のランキングを1つのリストで見せる。
// VenueRankingTemplateと異なりTOP/WORSTの分割は行わず、SceneHook+単一リスト+CTAの3構成
function BoatRankingTemplate({
  axisTitle,
  topLabel,
  rateLabel,
  hookQuestion,
  subCaption,
  categoryTag,
  allRates,
  listHeading,
  listData,
  ctaLines,
  subLine,
  brandName,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          axisTitle={axisTitle}
          topVenue={topLabel}
          rateLabel={rateLabel}
          hookQuestion={hookQuestion}
          subCaption={subCaption}
          categoryTag={categoryTag}
          allRates={allRates}
          topRateIndex={0}
          accentColor={GOLD}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneTop5 heading={listHeading} data={listData} barColor={GOLD} />
      </Sequence>
      <Sequence from={263} durationInFrames={150}>
        <SceneCTA ctaLines={ctaLines} subLine={subLine} brandName={brandName} />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

// ①複勝回収率ランキング（艇番別、2026-08-29投稿用）のデータ。race_results全件
// （payout_place_1/2、is_cancelled/is_no_race除外、39,728レース）から、
// 艇番Xが1着/2着だった場合のpayout_place合計÷総レース数で算出。
// 単勝回収率（1号艇90.0%、既出）と同じ「人気艇ほど回収率が高い」傾向が複勝でも一致
const PLACE_RETURN_DATA = [
  { venue: "1号艇", value: "94.8%", sample: "39,728", ratio: 100 },
  { venue: "2号艇", value: "86.3%", sample: "39,728", ratio: 91 },
  { venue: "3号艇", value: "81.6%", sample: "39,728", ratio: 86 },
  { venue: "4号艇", value: "81.0%", sample: "39,728", ratio: 85 },
  { venue: "5号艇", value: "74.8%", sample: "39,728", ratio: 79 },
  { venue: "6号艇", value: "52.8%", sample: "39,728", ratio: 56 },
];
const PLACE_RETURN_ALL = [94.8, 86.3, 81.6, 81.0, 74.8, 52.8];

export function BoatRankingCM_PlaceReturn() {
  return (
    <BoatRankingTemplate
      topLabel="1号艇"
      axisTitle="複勝回収率ランキング"
      rateLabel="複勝回収率 94.8%"
      hookQuestion="複勝でも、堅いのは結局1号艇？"
      subCaption="全艇番・全期間39,728レースで検証"
      categoryTag="艇番別データ"
      allRates={PLACE_RETURN_ALL}
      listHeading="🥈 複勝回収率ランキング（艇番別）"
      listData={PLACE_RETURN_DATA}
      ctaLines={["艇番ごとの回収率、", "無料で見れる"]}
      subLine="単勝でも複勝でも、1号艇が一番堅い"
    />
  );
}

// ②1号艇が1着を逃した時、代わりに1着になる艇の分布（2026-08-29投稿用）のデータ。
// race_results全件のうちrank1≠1の17,883レースを対象に、rank1の艇番分布を集計
const RUNNER_UP_DATA = [
  { venue: "2号艇", value: "30.0%", sample: "5,363/17,883", ratio: 100 },
  { venue: "3号艇", value: "28.0%", sample: "5,008/17,883", ratio: 93 },
  { venue: "4号艇", value: "22.0%", sample: "3,931/17,883", ratio: 73 },
  { venue: "5号艇", value: "13.2%", sample: "2,364/17,883", ratio: 44 },
  { venue: "6号艇", value: "6.8%", sample: "1,217/17,883", ratio: 23 },
];
const RUNNER_UP_ALL = [30.0, 28.0, 22.0, 13.2, 6.8];

export function BoatRankingCM_RunnerUp() {
  return (
    <BoatRankingTemplate
      topLabel="2号艇"
      axisTitle="1号艇飛び時の浮上率"
      rateLabel="1号艇が飛んだ時の浮上率 30.0%"
      hookQuestion="1号艇が飛んだら、代わりに来るのは？"
      subCaption="1号艇が1着を逃した17,883レースで検証"
      categoryTag="艇番別データ"
      allRates={RUNNER_UP_ALL}
      listHeading="🎯 1号艇不在時、1着になる艇の分布"
      listData={RUNNER_UP_DATA}
      ctaLines={["1号艇が危ないレースの", "狙い目も、無料で見れる"]}
      subLine="2号艇が僅差でトップ、3号艇も僅差"
    />
  );
}

// ④全レースの決まり手比率（全艇合算、2026-08-29投稿用）のデータ。race_results全件
// （39,728レース）のwinning_technique列を集計。逃げが過半数を占める
const TECHNIQUE_SHARE_DATA = [
  { venue: "逃げ", value: "53.0%", sample: "21,039", ratio: 100 },
  { venue: "まくり", value: "15.7%", sample: "6,249", ratio: 30 },
  { venue: "まくり差し", value: "12.1%", sample: "4,804", ratio: 23 },
  { venue: "差し", value: "12.1%", sample: "4,788", ratio: 23 },
  { venue: "抜き", value: "6.3%", sample: "2,504", ratio: 12 },
  { venue: "恵まれ", value: "0.8%", sample: "336", ratio: 2 },
];
const TECHNIQUE_SHARE_ALL = [53.0, 15.7, 12.1, 12.1, 6.3, 0.8];

export function BoatRankingCM_TechniqueShare() {
  return (
    <BoatRankingTemplate
      topLabel="逃げ"
      axisTitle="決まり手シェア"
      rateLabel="決まり手シェア 53.0%"
      hookQuestion="レースの決着、一番多い型は？"
      subCaption="全国39,728レースの決まり手を集計"
      categoryTag="決まり手データ"
      allRates={TECHNIQUE_SHARE_ALL}
      listHeading="🏁 決まり手の全国シェア"
      listData={TECHNIQUE_SHARE_DATA}
      ctaLines={["会場別の決まり手比率も、", "無料で見れる"]}
      subLine="逃げが過半数、まくりが2番手"
    />
  );
}

// ③鳴門・1号艇が「逃げ」で勝つ確率（2026-08-29投稿用）のデータ。
// winning_technique_stats（boat_number=1、winning_technique=逃げ）を全24会場で比較。
// 鳴門98.28%が全国1位、既出の江戸川93.61%（KimariteCM、勝ちパターン紹介の元祖）を上回る
const NIGE_WIN_TOP5 = [
  { venue: "鳴門", value: "98.28%", sample: "228/232", ratio: 100 },
  { venue: "尼崎", value: "97.11%", sample: "403/415", ratio: 99 },
  { venue: "宮島", value: "97.07%", sample: "265/273", ratio: 99 },
  { venue: "戸田", value: "96.86%", sample: "185/191", ratio: 99 },
  { venue: "住之江", value: "96.69%", sample: "234/242", ratio: 98 },
];
const NIGE_WIN_ALL = [98.28, 97.11, 97.07, 96.86, 96.69];

export function BoatRankingCM_NarutoNigeWin() {
  return (
    <BoatRankingTemplate
      topLabel="鳴門"
      axisTitle="鳴門 逃げ勝率"
      rateLabel="逃げで勝つ確率 98.28%"
      hookQuestion="鳴門で1号艇が勝つとき、ほぼ確実にコレ"
      subCaption="1号艇が勝った232レース中228レースが逃げ"
      categoryTag="決まり手データ"
      allRates={NIGE_WIN_ALL}
      listHeading="🚤 1号艇が「逃げ」で勝つ確率 TOP5"
      listData={NIGE_WIN_TOP5}
      ctaLines={["会場ごとの必勝パターンも、", "無料で見れる"]}
      subLine="鳴門の1号艇は、ほぼ逃げ一択"
    />
  );
}

// --- 決まり手の安定度比較（YouTube Shorts用、2026-09-02新設） ---
// boat-number-technique-consistency記事・note・YouTube解説動画（16:9）と同じネタ・
// 同じ実データをYouTube Shorts / TikTok / X向け縦型（9:16）に再構成したもの。
// 1号艇は「1位/2位/3位/23位/24位」という明確な順位がブログ記事に明記されている
// ためRankRow（既存のランキング表現）をそのまま使う。一方4号艇側は記事本文に
// 明確な全国順位の記載が無く（「1位の決まり手」が変わる代表例として6会場を提示
// しているだけ）、RankRowの「順位バッジ」を使うと無い順位を捏造することになる
// ため、順位バッジ無しの横棒リスト（SceneVenueBars、新設）で表現する
function SceneVenueBars({ heading, data, note }) {
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
            color: ACCENT,
            fontSize: 36,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 26,
            lineHeight: 1.3,
            whiteSpace: "pre-line",
          }}
        >
          {heading}
        </div>
      </Pop>
      {data.map((r, i) => (
        <SlideIn key={r.venue} delay={10 + i * 8} style={{ marginBottom: 20 }}>
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
                fontSize: 30,
                fontWeight: 800,
                fontFamily: FONT,
              }}
            >
              {r.venue}
            </span>
            <span
              style={{
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: 32,
                color: r.emphasis ? ACCENT : GOLD,
              }}
            >
              {r.value}
              <span
                style={{
                  color: WHITE,
                  fontSize: 18,
                  fontWeight: 700,
                  opacity: 0.75,
                  marginLeft: 8,
                }}
              >
                {r.technique}
              </span>
            </span>
          </div>
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
                width: `${r.ratio}%`,
                background: r.emphasis ? ACCENT : GOLD,
                borderRadius: 6,
              }}
            />
          </div>
        </SlideIn>
      ))}
      {note && (
        <Pop delay={10 + data.length * 8 + 10} style={{ marginTop: 14 }}>
          <div
            style={{
              color: "rgba(248,250,252,0.6)",
              fontSize: 20,
              fontFamily: FONT,
            }}
          >
            {note}
          </div>
        </Pop>
      )}
    </AbsoluteFill>
  );
}

// 1号艇の逃げ率（記事本文の表の「1位/2位/3位/23位/24位」をそのまま使用）
const NIGE_CONSISTENCY_TOP5 = [
  { rank: 1, venue: "鳴門", value: "97.41%", sample: "226/232", ratio: 97 },
  { rank: 2, venue: "戸田", value: "97.22%", sample: "175/180", ratio: 97 },
  { rank: 3, venue: "尼崎", value: "96.82%", sample: "396/409", ratio: 97 },
  { rank: 23, venue: "江戸川", value: "91.94%", sample: "194/211", ratio: 92 },
  { rank: 24, venue: "浜名湖", value: "91.54%", sample: "292/319", ratio: 92 },
];
const NIGE_CONSISTENCY_ALL = [97.41, 97.22, 96.82, 91.94, 91.54];

// 4号艇の1位の決まり手（記事本文の表と同じ6会場。全国順位は記事に記載が無いため
// 順位バッジは使わず、venue+値+決まり手のみを提示）
const BOAT4_TECHNIQUE_BARS = [
  { venue: "蒲郡", value: "66.07%", technique: "まくり", ratio: 66 },
  { venue: "桐生", value: "64.71%", technique: "まくり", ratio: 65 },
  { venue: "常滑", value: "62.50%", technique: "まくり", ratio: 63 },
  {
    venue: "若松",
    value: "38.46%",
    technique: "差し",
    ratio: 38,
    emphasis: true,
  },
  {
    venue: "三国",
    value: "36.36%",
    technique: "まくり差し",
    ratio: 36,
    emphasis: true,
  },
  { venue: "丸亀", value: "36.17%", technique: "まくり", ratio: 36 },
];

export function BoatRankingCM_TechniqueConsistency() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          axisTitle="決まり手の安定度格差"
          topVenue="鳴門"
          rateLabel="1号艇 逃げ率 97.41%"
          hookQuestion="でも4号艇の決まり手は、会場でバラバラ"
          subCaption="全24会場の実データで比較すると…"
          categoryTag="決まり手データ"
          allRates={NIGE_CONSISTENCY_ALL}
          topRateIndex={0}
          accentColor={GOLD}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneWorst5
          heading="🎯 1号艇の逃げ率（上位3・下位2）"
          data={NIGE_CONSISTENCY_TOP5}
          barColor={GOLD}
          headingColor={GOLD}
          sampleSuffix="レースで集計"
        />
      </Sequence>
      <Sequence from={263} durationInFrames={188}>
        <SceneVenueBars
          heading={"🌊 4号艇の1位の決まり手\n会場によって主役が変わる"}
          data={BOAT4_TECHNIQUE_BARS}
          note="若松・三国は「まくり」以外が1位"
        />
      </Sequence>
      <Sequence from={451} durationInFrames={150}>
        <SceneCTA
          ctaLines={["会場ごとの決まり手データ、", "無料で見れる"]}
          subLine="1号艇は逃げ一強、4号艇は会場で戦い方が変わる"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
