import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { NAVY, GOLD, WHITE, ACCENT, FONT, Logo, SceneCTA } from "./noteVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

/**
 * YouTube向け（16:9, 1920x1080）会場×全国平均 比較型。
 *
 * `sns-pipeline-youtube.md`の`venue-feature`型のうち、1会場の指標を「全国平均との
 * 差」というフレーミングで見せるためのprops駆動テンプレート（`VenueRankingCM.jsx`の
 * `VenueRankingTemplate`と同じ量産方針。指標・会場名を差し替えるだけで別ネタに再利用
 * できる）。
 *
 * 2026-09-05新設の経緯: 過去に同種の「会場×全国平均比較」動画
 * （content_group_id=118e3cef...、format='venue-comparison'）がRoutineの
 * 実行環境内で自己完結スクリプトとしてレンダリングされ、コンポジションが
 * コミットされていなかった（`.claude/rules/sns-content-generation.md`が警告する
 * 「片方のパイプラインだけ実装され他方に伝播しない」不具合と同種）。再発防止のため、
 * このバージョンは他の会場攻略型と同じくRoot.jsxに登録し、リポジトリにコミットする。
 *
 * ビジュアル言語はYouTube向け先行実装`RaceInsightYoutubeCM.jsx`と共通化
 * （`noteVideoShared.jsx`のNAVY/GOLD/Logo/SceneCTAを再利用）。
 */

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;
  const scale = spring({ frame: local, fps, config: { damping: 12, mass: 0.5 } });
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
  const x = interpolate(local, [0, 12], [50, 0], {
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

// --- Scene 1: フック（0-90f, 3s。frame=0でサムネイルとしても成立） ---
function SceneHook({
  venueName,
  venueRate,
  nationalAvg,
  windowLabel,
  axisTitle,
  allRates,
  highlightIndex,
  hookQuestion,
  subCaption,
  headlineText,
}) {
  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    headlineText,
    {
      maxWidth: 1500,
      maxLines: 2,
      fontFamily: FONT,
      fontWeight: 900,
      maxFontSize: 72,
      minFontSize: 44,
    },
  );
  const minRate = Math.min(...allRates);
  const maxRate = Math.max(...allRates);

  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      {/* 実データの可視化: 24会場のミニバーチャートを背景に敷く（装飾ではなく裏付けデータ） */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 12,
          padding: "0 120px 260px",
          opacity: 0.85,
        }}
      >
        {allRates.map((r, i) => {
          const h = interpolate(r, [minRate, maxRate], [40, 420]);
          const isTarget = i === highlightIndex;
          return (
            <div
              key={i}
              style={{
                width: 36,
                height: h,
                background: isTarget ? GOLD : "rgba(255,255,255,0.1)",
                borderRadius: "4px 4px 0 0",
              }}
            />
          );
        })}
      </AbsoluteFill>

      {/* 全国平均線 */}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 260 + interpolate(nationalAvg, [minRate, maxRate], [40, 420]),
          borderTop: "2px dashed rgba(248,250,252,0.5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 60,
          bottom: 260 + interpolate(nationalAvg, [minRate, maxRate], [40, 420]) + 8,
          color: "rgba(248,250,252,0.7)",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: FONT,
        }}
      >
        全国平均 {nationalAvg}%
      </div>

      <Pop delay={-10} style={{ position: "absolute", top: 56, left: 64 }}>
        <Logo size={52} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 60, right: 64 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${GOLD}`,
            borderRadius: 999,
            padding: "8px 22px",
            color: GOLD,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          24会場・実データ比較
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 150, left: 40, right: 40, textAlign: "center" }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: headlineFontSize,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.2,
            textShadow: `0 0 40px ${GOLD}77`,
          }}
        >
          {headlineLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 330,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 60,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ color: WHITE, fontSize: 30, fontWeight: 700, fontFamily: FONT, marginBottom: 6 }}>
            {venueName}
          </div>
          <div style={{ color: GOLD, fontSize: 96, fontWeight: 900, fontFamily: FONT, lineHeight: 1 }}>
            {venueRate}%
          </div>
        </div>
        <div style={{ color: "rgba(248,250,252,0.4)", fontSize: 56, fontWeight: 900, marginBottom: 10 }}>
          ≒
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              color: "rgba(248,250,252,0.7)",
              fontSize: 30,
              fontWeight: 700,
              fontFamily: FONT,
              marginBottom: 6,
            }}
          >
            全国平均
          </div>
          <div
            style={{
              color: "rgba(248,250,252,0.85)",
              fontSize: 96,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
            }}
          >
            {nationalAvg}%
          </div>
        </div>
      </Pop>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: GOLD,
          padding: "36px 60px 70px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY,
              fontSize: 44,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
              marginBottom: 8,
            }}
          >
            {hookQuestion}
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: `${NAVY}cc`,
              fontSize: 24,
              fontWeight: 700,
              fontFamily: FONT,
              textAlign: "center",
            }}
          >
            {subCaption}（{windowLabel}）
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 実データ比較（90-270f, 6s） ---
function StatCard({ label, value, unit, sub, accentColor, delay }) {
  return (
    <Pop
      delay={delay}
      style={{
        background: "rgba(255,255,255,0.06)",
        border: `2px solid ${accentColor}90`,
        borderRadius: 24,
        padding: "36px 40px",
        width: 520,
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: accentColor,
          fontSize: 26,
          fontWeight: 800,
          fontFamily: FONT,
          marginBottom: 16,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6 }}>
        <span style={{ fontSize: 100, fontWeight: 900, fontFamily: FONT, color: WHITE, lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ fontSize: 36, fontWeight: 800, fontFamily: FONT, color: "rgba(248,250,252,0.7)" }}>
          {unit}
        </span>
      </div>
      <div style={{ marginTop: 14, color: "rgba(248,250,252,0.55)", fontSize: 22, fontFamily: FONT }}>
        {sub}
      </div>
    </Pop>
  );
}

function SceneStats({
  venueName,
  venueRate,
  venueSample,
  nationalAvg,
  nationalVenueCount,
  nationalSampleTotal,
  diffLabel,
  rankPosition,
  totalVenues,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY, justifyContent: "center", alignItems: "center" }}>
      <Pop delay={2} style={{ position: "absolute", top: 90, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ color: ACCENT, fontSize: 34, fontWeight: 900, fontFamily: FONT }}>
          📊 実データで比較
        </div>
      </Pop>

      <div style={{ display: "flex", gap: 40, marginTop: 10 }}>
        <StatCard
          label={venueName}
          value={venueRate}
          unit="%"
          sub={`${venueSample}レースで集計`}
          accentColor={GOLD}
          delay={16}
        />
        <StatCard
          label="全国平均"
          value={nationalAvg}
          unit="%"
          sub={`${nationalVenueCount}会場・計${nationalSampleTotal}レース`}
          accentColor={ACCENT}
          delay={30}
        />
      </div>

      <SlideIn delay={54} style={{ marginTop: 44 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            background: "rgba(255,255,255,0.06)",
            border: `1.5px solid ${GOLD}77`,
            borderRadius: 999,
            padding: "18px 36px",
          }}
        >
          <span style={{ color: GOLD, fontSize: 28, fontWeight: 900, fontFamily: FONT }}>
            差 {diffLabel}
          </span>
          <span style={{ color: "rgba(248,250,252,0.6)", fontSize: 24, fontFamily: FONT }}>
            ／ {totalVenues}会場中 {rankPosition}位
          </span>
        </div>
      </SlideIn>
    </AbsoluteFill>
  );
}

// --- Scene 3: 会場間の差（270-450f, 6s。TOPとWORSTを添えて「桐生は平均的」の裏付けを示す） ---
function VenueRow({ label, name, value, delay, accentColor }) {
  return (
    <SlideIn delay={delay} style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 30 }}>
      <div
        style={{
          width: 210,
          color: accentColor,
          fontSize: 24,
          fontWeight: 800,
          fontFamily: FONT,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ color: WHITE, fontSize: 40, fontWeight: 800, fontFamily: FONT, flex: 1 }}>
        {name}
      </div>
      <div style={{ color: accentColor, fontSize: 44, fontWeight: 900, fontFamily: FONT }}>
        {value}%
      </div>
    </SlideIn>
  );
}

function SceneContext({ axisTitle, topVenue, worstVenue, venueName, venueRate, contextSummary }) {
  return (
    <AbsoluteFill style={{ background: NAVY, padding: "0 120px", justifyContent: "center" }}>
      <Pop delay={2}>
        <div style={{ color: ACCENT, fontSize: 36, fontWeight: 900, fontFamily: FONT, marginBottom: 40 }}>
          🌊 会場でここまで差がある中、{venueName}は？
        </div>
      </Pop>
      <VenueRow label="最も高い会場" name={topVenue.name} value={topVenue.rate} delay={12} accentColor={GOLD} />
      <VenueRow label={`${venueName}（今回）`} name={venueName} value={venueRate} delay={24} accentColor={ACCENT} />
      <VenueRow label="最も低い会場" name={worstVenue.name} value={worstVenue.rate} delay={36} accentColor="#f87171" />
      <SlideIn delay={50} style={{ marginTop: 20 }}>
        <div style={{ color: "rgba(248,250,252,0.6)", fontSize: 26, fontFamily: FONT }}>
          {contextSummary}
        </div>
      </SlideIn>
    </AbsoluteFill>
  );
}

export function VenueVsAverageYoutubeTemplate({
  venueName,
  axisTitle,
  venueRate,
  venueSample,
  nationalAvg,
  nationalVenueCount,
  nationalSampleTotal,
  windowLabel,
  diffLabel,
  rankPosition,
  totalVenues,
  topVenue,
  worstVenue,
  allRates,
  highlightIndex,
  hookQuestion,
  subCaption,
  featureDigest,
  headlineText,
  contextSummary,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <Sequence from={0} durationInFrames={90}>
        <SceneHook
          venueName={venueName}
          venueRate={venueRate}
          nationalAvg={nationalAvg}
          windowLabel={windowLabel}
          axisTitle={axisTitle}
          allRates={allRates}
          highlightIndex={highlightIndex}
          hookQuestion={hookQuestion}
          subCaption={subCaption}
          headlineText={headlineText}
        />
      </Sequence>
      <Sequence from={90} durationInFrames={180}>
        <SceneStats
          venueName={venueName}
          venueRate={venueRate}
          venueSample={venueSample}
          nationalAvg={nationalAvg}
          nationalVenueCount={nationalVenueCount}
          nationalSampleTotal={nationalSampleTotal}
          diffLabel={diffLabel}
          rankPosition={rankPosition}
          totalVenues={totalVenues}
        />
      </Sequence>
      <Sequence from={270} durationInFrames={180}>
        <SceneContext
          axisTitle={axisTitle}
          topVenue={topVenue}
          worstVenue={worstVenue}
          venueName={venueName}
          venueRate={venueRate}
          contextSummary={contextSummary}
        />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA featureDigest={featureDigest} />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} loop />
    </AbsoluteFill>
  );
}

// デモ・composition登録確認用（実データはprops経由で渡す運用、VenueRankingTemplateと同じ方針）
export function VenueVsAverageYoutubeCM_Demo() {
  return (
    <VenueVsAverageYoutubeTemplate
      venueName="桐生"
      axisTitle="1号艇勝率"
      venueRate={54.8}
      venueSample={560}
      nationalAvg={54.5}
      nationalVenueCount={24}
      nationalSampleTotal={13447}
      windowLabel="直近90日"
      diffLabel="+0.3pt"
      rankPosition={15}
      totalVenues={24}
      topVenue={{ name: "下関", rate: 63.1 }}
      worstVenue={{ name: "平和島", rate: 39.6 }}
      allRates={[
        54.8, 41.6, 44.9, 39.6, 55.3, 54.3, 52.0, 61.5, 54.9, 52.8, 55.9, 51.2,
        61.1, 55.2, 56.3, 52.7, 57.3, 57.1, 63.1, 56.0, 58.0, 59.4, 54.9, 59.7,
      ]}
      highlightIndex={0}
      hookQuestion="会場によって、実はここまで差がある"
      subCaption="24会場・13,447レースで検証"
      featureDigest={["24会場のデータ", "無料", "登録不要"]}
      headlineText="桐生の1号艇勝率は全国平均とほぼ同じ"
      contextSummary="1号艇勝率は会場によって大きく異なるが、桐生は全国平均に近い水準"
    />
  );
}
