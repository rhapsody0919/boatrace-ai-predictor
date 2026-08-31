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
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

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
          background: ACCENT,
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

// --- 会場ランキング行 ---
function RankRow({ rank, venue, value, sample, delay, barColor, barRatio }) {
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
          {sample}レースを集計
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
        平均 {avgRate.toFixed(1)}%
      </div>

      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
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
            位
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

export function VenueRankingCM_WinRate_VariantB() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHookDiagonal
          topVenue="尼崎"
          topRateLabel="61.1%"
          bottomVenue="戸田"
          bottomRateLabel="41.6%"
          diffLabel="19.5pt"
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

// 1号艇勝率ランキング（2026-08-24、第3弾・試作）のデータ。全期間集計、TOP1位(尼崎61.1%)を100とした相対比率
const WIN_RATE_TOP5 = [
  { venue: "尼崎", value: "61.1%", sample: "1,850", ratio: 100 },
  { venue: "徳山", value: "61.1%", sample: "1,824", ratio: 100 },
  { venue: "大村", value: "60.4%", sample: "1,654", ratio: 99 },
  { venue: "下関", value: "60.4%", sample: "1,625", ratio: 99 },
  { venue: "芦屋", value: "60.4%", sample: "1,620", ratio: 99 },
];

const WIN_RATE_WORST5 = [
  { rank: 24, venue: "戸田", value: "41.6%", sample: "1,559", ratio: 68 },
  { rank: 23, venue: "平和島", value: "44.0%", sample: "1,551", ratio: 72 },
  { rank: 22, venue: "江戸川", value: "46.5%", sample: "1,433", ratio: 76 },
  { rank: 21, venue: "桐生", value: "49.5%", sample: "1,677", ratio: 81 },
  { rank: 20, venue: "鳴門", value: "49.8%", sample: "1,341", ratio: 82 },
];

// SceneHookの背景データバー用。venue_code(1〜24)順、全期間集計。
// 2026-08-24: 1号艇勝率は全24会場を再取得(尼崎が1位、index12)。
// イン逃げ率・万舟率はTOP5/WORST5の10件のみのため暫定的に同じ配列を流用
const WIN_RATE_ALL = [
  49.5, 41.6, 46.5, 44.0, 54.8, 53.7, 54.9, 57.5, 56.8, 50.7, 53.8, 58.3, 61.1,
  49.8, 55.5, 55.1, 56.9, 61.1, 60.4, 58.7, 60.4, 59.4, 55.5, 60.4,
];
const WIN_RATE_TOP_INDEX = 12; // 尼崎(venue_code=13)

const NIGE_RATE_ALL = [
  47.3, 39.8, 43.3, 42.3, 52.0, 50.6, 52.9, 54.7, 54.3, 47.9, 51.8, 56.3, 59.2,
  47.8, 53.3, 52.8, 54.3, 58.5, 56.6, 56.2, 57.3, 55.5, 52.7, 57.3,
];
const NIGE_RATE_TOP_INDEX = 12; // 尼崎(venue_code=13)

// 1号艇モーター2連率ランキング（2026-08-25、第5弾）のデータ。races.first_boat_motor_2rateの
// 全期間平均、venue_code(1〜24)順。TOP1位(常滑34.1%)を100とした相対比率
const MOTOR2RATE_TOP5 = [
  { venue: "常滑", value: "34.1%", sample: "1,868", ratio: 100 },
  { venue: "丸亀", value: "34.0%", sample: "1,776", ratio: 100 },
  { venue: "宮島", value: "33.9%", sample: "1,680", ratio: 99 },
  { venue: "唐津", value: "33.6%", sample: "1,776", ratio: 99 },
  { venue: "平和島", value: "33.6%", sample: "1,608", ratio: 99 },
];

const MOTOR2RATE_WORST5 = [
  { rank: 24, venue: "福岡", value: "30.7%", sample: "1,632", ratio: 90 },
  { rank: 23, venue: "鳴門", value: "31.6%", sample: "1,380", ratio: 93 },
  { rank: 22, venue: "芦屋", value: "31.9%", sample: "1,692", ratio: 94 },
  { rank: 21, venue: "津", value: "31.9%", sample: "1,557", ratio: 94 },
  { rank: 20, venue: "住之江", value: "31.9%", sample: "1,512", ratio: 94 },
];

const MOTOR2RATE_ALL = [
  32.4, 32.3, 32.1, 33.6, 32.1, 32.3, 32.5, 34.1, 31.9, 32.0, 32.0, 31.9, 32.1,
  31.6, 34.0, 32.7, 33.9, 32.2, 32.2, 32.6, 31.9, 30.7, 33.6, 32.3,
];
const MOTOR2RATE_TOP_INDEX = 7; // 常滑(venue_code=8)

// --- Scene 2: TOP5（75-263f, 約6.3s） ---
function SceneTop5({ heading, data, barColor }) {
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
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: ワースト5（263-450f, 約6.3s） ---
function SceneWorst5({ heading, data, barColor }) {
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
            color: "#7dd3fc",
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
        />
      ))}
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
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneTop5
          heading={top5Heading}
          data={top5Data}
          barColor={barColorTop}
        />
      </Sequence>
      <Sequence from={263} durationInFrames={187}>
        <SceneWorst5
          heading={worst5Heading}
          data={worst5Data}
          barColor={barColorWorst}
        />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA ctaLines={ctaLines} subLine={subLine} />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
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
      subCaption="24会場・38,600レースで検証"
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
        <SceneCTA ctaLines={ctaLines} subLine={subLine} />
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
