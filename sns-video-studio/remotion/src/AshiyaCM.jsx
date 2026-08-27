import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * 会場紹介型（第2弾: 芦屋、2026-08-26修正） — 龍神レーダー Shorts
 *
 * 2026-08-26: 8人パネル議論を経て全面修正。
 * 修正前の問題点: (1) 1号艇勝率「63%」が誤り（実際はVenueRankingCM.jsxの検証済み
 * データで60.4%、24会場中3位タイ。尼崎・徳山が61.1%で1-2位）。(2) 同じ写真を
 * 4シーン中3シーンで使い回していた。(3) アクセントカラーが水色で、同日投稿する
 * データランキング型4本（GOLD基調）とブランドが不一致に見えた。(4) 岡湊神社の
 * トリビアがボートレースと無関係で唐突だった。
 *
 * 修正: GOLDに統一、正しい数値、神社トリビアを他会場との実データ比較シーンに
 * 差し替え（写真の使い回しも解消）。将来の他会場展開に備え、VenueIntroTemplate
 * として汎用化した。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const GOLD = "#d4af37";
const WHITE = "#f8fafc";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

function FadeUp({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;
  const progress = spring({
    frame: local,
    fps,
    config: { damping: 200 },
  });
  const opacity = interpolate(local, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(progress, [0, 1], [24, 0]);
  return (
    <div
      style={{ opacity, transform: `translateY(${translateY}px)`, ...style }}
    >
      {children}
    </div>
  );
}

function KenBurnsPhoto({ src }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1.08, 1.22]);
  return (
    <Img
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${scale})`,
      }}
    />
  );
}

function Scrim({ from = "rgba(15,44,70,0.15)", to = "rgba(15,44,70,0.85)" }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(to bottom, ${from} 0%, ${to} 100%)`,
      }}
    />
  );
}

function Logo({ size = 44 }) {
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
      <span style={{ color: WHITE, fontSize: size * 0.48, fontWeight: 800 }}>
        龍神レーダー
      </span>
    </div>
  );
}

// --- Scene 1: フック（0-75f, 2.5s） ---
// photoFileが無い会場（実写素材未取得）は、VenueRankingCM系と同じダークグラデーション
// 背景にフォールバックする（写真の有無で見た目が破綻しないようにするため）
function SceneHook({ photoFile, venueTitle, tagline }) {
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      {photoFile ? (
        <>
          <KenBurnsPhoto src={staticFile(photoFile)} />
          <Scrim from="rgba(15,44,70,0.35)" to="rgba(15,44,70,0.9)" />
        </>
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 50% 30%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
          }}
        />
      )}
      <FadeUp delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </FadeUp>
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "0 60px 140px",
        }}
      >
        <FadeUp delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 40,
              fontWeight: 900,
              textAlign: "center",
              lineHeight: 1.3,
              textShadow: "0 4px 20px rgba(0,0,0,0.4)",
            }}
          >
            {venueTitle}
          </div>
        </FadeUp>
        <FadeUp delay={-10}>
          <div
            style={{
              marginTop: 18,
              color: GOLD,
              fontSize: 30,
              fontWeight: 800,
              textAlign: "center",
              textShadow: "0 4px 20px rgba(0,0,0,0.4)",
            }}
          >
            {tagline}
          </div>
        </FadeUp>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// --- Scene 2: データ提示（75-165f, 3s） ---
function SceneStat({ winRate, rankLabel }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <FadeUp delay={0}>
        <div
          style={{
            color: WHITE,
            fontSize: 26,
            fontWeight: 700,
            textAlign: "center",
            opacity: 0.9,
            fontFamily: FONT,
          }}
        >
          1号艇勝率
        </div>
      </FadeUp>
      <FadeUp delay={10}>
        <div
          style={{
            color: GOLD,
            fontSize: 130,
            fontWeight: 900,
            lineHeight: 1,
            textShadow: "0 6px 30px rgba(0,0,0,0.5)",
            fontFamily: FONT,
          }}
        >
          {winRate}
        </div>
      </FadeUp>
      <FadeUp delay={22}>
        <div
          style={{
            color: WHITE,
            fontSize: 24,
            fontWeight: 700,
            opacity: 0.85,
            fontFamily: FONT,
          }}
        >
          {rankLabel}
        </div>
      </FadeUp>
    </AbsoluteFill>
  );
}

// --- Scene 3: 他会場との実データ比較（165-255f, 3s） ---
// 岡湊神社トリビア（ボートレースと無関係）を廃止し、実データ比較に差し替え。
// 写真の使い回しも解消（このシーンは背景がチャート、写真無し）
function CompareRow({ venue, value, delay, highlight }) {
  return (
    <FadeUp delay={delay} style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 28px",
          marginBottom: 12,
          borderRadius: 12,
          background: highlight
            ? "rgba(212,175,55,0.18)"
            : "rgba(255,255,255,0.04)",
          border: highlight
            ? `2px solid ${GOLD}`
            : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          style={{
            color: highlight ? GOLD : WHITE,
            fontSize: 32,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          {venue}
        </span>
        <span
          style={{
            color: highlight ? GOLD : "rgba(248,250,252,0.8)",
            fontSize: 32,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          {value}
        </span>
      </div>
    </FadeUp>
  );
}

function SceneCompare({ heading, rows }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        justifyContent: "center",
        padding: "0 60px",
      }}
    >
      <FadeUp delay={0}>
        <div
          style={{
            color: GOLD,
            fontSize: 32,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          {heading}
        </div>
      </FadeUp>
      {rows.map((r, i) => (
        <CompareRow
          key={r.venue}
          venue={r.venue}
          value={r.value}
          highlight={r.highlight}
          delay={8 + i * 8}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（255-330f, 2.5s） ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <FadeUp delay={4}>
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
          全24会場のデータ、
          <br />
          無料で見れる
        </div>
      </FadeUp>
      <FadeUp delay={16} style={{ marginBottom: 40 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 26,
            fontFamily: FONT,
          }}
        >
          あなたの推し会場は、何位？
        </div>
      </FadeUp>
      <FadeUp delay={28}>
        <Logo size={48} />
      </FadeUp>
    </AbsoluteFill>
  );
}

// 会場紹介型・共通テンプレート。venueName/photoFile/winRate等を差し替えるだけで
// 他会場に量産できる設計（VenueRankingTemplateと同じ思想）
function VenueIntroTemplate({
  photoFile,
  venueTitle,
  tagline,
  winRate,
  rankLabel,
  compareHeading,
  compareRows,
}) {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack.wav")} />
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          photoFile={photoFile}
          venueTitle={venueTitle}
          tagline={tagline}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={90}>
        <SceneStat winRate={winRate} rankLabel={rankLabel} />
      </Sequence>
      <Sequence from={165} durationInFrames={90}>
        <SceneCompare heading={compareHeading} rows={compareRows} />
      </Sequence>
      <Sequence from={255} durationInFrames={75}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}

// 芦屋（2026-08-26修正版）のデータ。1号艇勝率60.4%はVenueRankingCM.jsxの
// WIN_RATE_ALL（venue_code=21、全期間race_results集計）と一致する検証済みの値。
// 24会場中、尼崎・徳山の61.1%に次ぐ60.4%タイ（下関・大村と同率）で3位タイ
export function AshiyaCM() {
  return (
    <VenueIntroTemplate
      photoFile="ashiya.jpg"
      venueTitle="ボートレース芦屋"
      tagline="日本一インが強い場のひとつ"
      winRate="60.4%"
      rankLabel="全国トップクラス（24会場中3位タイ）"
      compareHeading="🏆 1号艇勝率ランキング（抜粋）"
      compareRows={[
        { venue: "尼崎", value: "61.1%" },
        { venue: "徳山", value: "61.1%" },
        { venue: "芦屋", value: "60.4%", highlight: true },
        { venue: "下関", value: "60.4%" },
        { venue: "大村", value: "60.4%" },
      ]}
    />
  );
}

// 尼崎（2026-08-27、VenueIntroTemplate第2弾）のデータ。実写素材が無いため
// photoFile未指定でダークグラデーション背景にフォールバック。1号艇勝率61.1%は
// VenueRankingCM.jsxのWIN_RATE_ALL（venue_code=13）で徳山と並び全国1位タイ、
// 最速スタート勝率でも82.8%で全国1位（VenueRankingCM_TopStart参照）という
// 複数指標での「尼崎最強」文脈が作れる会場
export function AmagasakiCM() {
  return (
    <VenueIntroTemplate
      venueTitle="ボートレース尼崎"
      tagline="複数指標で全国1位、最強のイン戦"
      winRate="61.1%"
      rankLabel="1号艇勝率 全国1位タイ（徳山と同率）"
      compareHeading="🏆 1号艇勝率ランキング（抜粋）"
      compareRows={[
        { venue: "尼崎", value: "61.1%", highlight: true },
        { venue: "徳山", value: "61.1%" },
        { venue: "下関", value: "60.4%" },
        { venue: "芦屋", value: "60.4%" },
        { venue: "大村", value: "60.4%" },
      ]}
    />
  );
}
