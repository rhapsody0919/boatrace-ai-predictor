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
 * 本日のデータ一覧型（第2弾: 本日のモーター調子ランキング）— 龍神レーダー TikTok Shorts
 *
 * 2026-08-25: TodaysRacerFormCM.jsx（好調・不調選手）と対になる「モーター」軸の日替わり型。
 * 実データ出典: Supabase race_entries.motor_2rate/motor_3rate。本日開催の全156レース・
 * 936エントリーを横断集計し、モーター2連率のTOP5/BOTTOM5を抽出した（取得日2026-08-25）。
 * boat-ai.jp「モーター調子」タブは1レースずつ見る設計で横断ランキング機能が無いため、
 * この横断集計はSupabaseから直接行った。
 *
 * 選手ランキング型との違い: 「90日前との比較（delta）」ではなく、モーター自体の
 * 実績値（2連率・3連率）そのものをランキングする。同じモーターでも選手が変われば
 * レース結果が変わるため、あくまで「このモーターの過去の実績」という参考情報。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
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

// --- モーターランキング行 ---
function MotorRow({
  rank,
  name,
  race,
  motor,
  rate2,
  delay,
  barColor,
  barRatio,
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
            {rate2.toFixed(1)}%
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
          {race}・{motor}（2連率）
        </span>
      </div>
    </SlideIn>
  );
}

// --- Scene 1: フック（0-75f, 2.5s） ---
// 会場攻略型・好調選手型と同じ案A（非対称配置＋色のベタ塗り分割＋下部フック帯）
function SceneHook({
  topName,
  topRace,
  rate2Label,
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

      {/* 何の数字か伝わるよう、巨大数字の直上にラベルを明示（2026-08-25の教訓を反映） */}
      <Pop delay={-10} style={{ position: "absolute", left: 44, top: 250 }}>
        <div
          style={{
            color: GOLD,
            fontSize: 32,
            fontWeight: 800,
            fontFamily: FONT,
            marginBottom: 8,
          }}
        >
          本日出走モーターの2連率
        </div>
      </Pop>
      {/* 「53.16%」は6文字あり、はみ出し防止のためfontSizeを150に抑える
          （複数文字の巨大表示ではみ出す教訓を踏まえた設計、2026-08-25） */}
      <Pop delay={-10} style={{ position: "absolute", left: 40, top: 320 }}>
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
          {rate2Label}
        </div>
      </Pop>

      {/* 選手名＋レース情報バッジ */}
      <div style={{ position: "absolute", left: 60, top: 700, right: 60 }}>
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

// --- Scene 2: 好調モーターTOP5（75-263f, 約6.3s） ---
function SceneTop({ data }) {
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
          🔧 本日の好調モーター TOP5
        </div>
      </Pop>
      {data.map((row, i) => (
        <MotorRow
          key={`${row.race}-${row.motor}`}
          rank={i + 1}
          name={row.name}
          race={row.race}
          motor={row.motor}
          rate2={row.rate2}
          delay={20 + i * 10}
          barColor={GOLD}
          barRatio={(row.rate2 / data[0].rate2) * 100}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: 要注意モーターTOP5（263-450f, 約6.2s） ---
function SceneWorst({ data }) {
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
          ⚠️ 本日の要注意モーター TOP5
        </div>
      </Pop>
      {data.map((row, i) => (
        <MotorRow
          key={`${row.race}-${row.motor}`}
          rank={i + 1}
          name={row.name}
          race={row.race}
          motor={row.motor}
          rate2={row.rate2}
          delay={20 + i * 10}
          barColor={RED}
          barRatio={(row.rate2 / data[0].rate2) * 100}
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

// 2026-08-25取得。Supabase race_entriesから本日開催全156レース・936エントリーを横断集計
const TOP5 = [
  { name: "柳瀬興志", race: "徳山2R・5号艇", motor: "68号機", rate2: 53.16 },
  { name: "深川麻奈美", race: "尼崎6R・5号艇", motor: "4号機", rate2: 52.3 },
  { name: "吉田俊彦", race: "尼崎7R・5号艇", motor: "23号機", rate2: 51.6 },
  { name: "山下和彦", race: "徳山3R・1号艇", motor: "33号機", rate2: 51.09 },
  { name: "鈴木柊介", race: "丸亀9R・4号艇", motor: "20号機", rate2: 50.9 },
];

const WORST5 = [
  { name: "深川真二", race: "福岡10R・2号艇", motor: "42号機", rate2: 14.1 },
  { name: "服部達哉", race: "浜名湖7R・1号艇", motor: "60号機", rate2: 14.3 },
  { name: "宮嵜隆太郎", race: "浜名湖4R・6号艇", motor: "27号機", rate2: 16.4 },
  { name: "関根彰人", race: "浜名湖2R・2号艇", motor: "43号機", rate2: 16.67 },
  { name: "森智哉", race: "江戸川5R・6号艇", motor: "14号機", rate2: 16.7 },
];

export function TodaysMotorFormCM() {
  const top = TOP5[0];
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          topName={top.name}
          topRace={top.race}
          rate2Label={`${top.rate2}%`}
          hookQuestion="本日、一番調子が良いモーターは？"
          subCaption="本日出走する全モーターの2連率を横断比較"
          categoryTag="本日出走・好調モーター"
        />
      </Sequence>
      <Sequence from={75} durationInFrames={188}>
        <SceneTop data={TOP5} />
      </Sequence>
      <Sequence from={263} durationInFrames={187}>
        <SceneWorst data={WORST5} />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA
          ctaLines={["本日の全モーターデータ、", "無料で見れる"]}
          subLine="あなたの狙う艇のモーターは、好調？不調？"
        />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
