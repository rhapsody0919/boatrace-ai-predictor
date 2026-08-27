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
  useVideoConfig,
} from "remotion";

const NAVY = "#0f2c46";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";
const WARN = "#ff9800";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;
  const scale = spring({
    frame: local,
    fps,
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

function PulseRings({ color = ACCENT, size = 420, top = "50%" }) {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 25, 50].map((delay) => {
        const local = frame - delay;
        const scale = interpolate(local % 75, [0, 75], [0.3, 2.6], {
          extrapolateLeft: "clamp",
        });
        const opacity = interpolate(local % 75, [0, 75], [0.35, 0], {
          extrapolateLeft: "clamp",
        });
        return (
          <div
            key={delay}
            style={{
              position: "absolute",
              top,
              left: "50%",
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: "50%",
              border: `3px solid ${color}`,
              transform: `scale(${scale})`,
              opacity,
            }}
          />
        );
      })}
    </>
  );
}

function Logo({ size = 44 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

function Mascot({ src, size = 260, style }) {
  return (
    <Img
      src={staticFile(src)}
      style={{
        width: size,
        height: "auto",
        objectFit: "contain",
        filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.35))",
        ...style,
      }}
    />
  );
}

// レース結果カードの表示サイズ(全レース共通)。ネイティブ高さのみレースごとの
// 行数(2〜3パターン)で変わるためrace.nativeHeightを都度使う
const CARD_DISPLAY_WIDTH = 1030;
const CARD_NATIVE_WIDTH = 1184;
const CARD_LEFT = (1080 - CARD_DISPLAY_WIDTH) / 2;
const CARD_TOP = 200;

function HighlightRing({ delay = 0, box }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const scale = spring({ frame: local, fps: 30, config: { damping: 14 } });
  const opacity = interpolate(local, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        ...box,
        border: "6px solid #f59e0b",
        borderRadius: 16,
        opacity,
        transform: `scale(${scale})`,
        boxShadow: "0 0 0 6px rgba(245,158,11,0.25)",
      }}
    />
  );
}

// --- Scene 1: フック（0-75f, 2.5s） ---
function SceneHook({ mascotSrc, hookLine }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 30%, #1c4a73 0%, ${NAVY} 65%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
        overflow: "hidden",
      }}
    >
      <PulseRings size={760} />
      <div
        style={{
          position: "absolute",
          top: 140,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(15,44,70,0.85)",
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 28,
            padding: "12px 28px",
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
          }}
        >
          🔍 AI予想 的中検証
        </div>
      </div>
      <Pop delay={0} style={{ marginBottom: 36 }}>
        <Mascot src={mascotSrc} size={400} />
      </Pop>
      <Pop delay={12}>
        <div
          style={{
            color: WHITE,
            fontSize: 54,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          {hookLine}
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: AIの警告（75-155f, 2.7s）イン崩れ指数を実データで提示 ---
function SceneWarning({ mascotSrc, warningReaction, race }) {
  const pct = Math.round(race.volatilityPercentile * 100);
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(150deg, #143752 0%, ${NAVY} 55%, #081b2c 100%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px",
      }}
    >
      <PulseRings color={WARN} size={820} />
      <Pop delay={0}>
        <div
          style={{
            color: WHITE,
            fontSize: 34,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
            opacity: 0.9,
            marginBottom: 22,
          }}
        >
          {race.raceLabel}・AIの警告はこう
        </div>
      </Pop>
      <Pop delay={6}>
        <div
          style={{
            background: "rgba(255,255,255,0.08)",
            border: `2px solid ${WARN}`,
            borderRadius: 24,
            padding: "34px 44px",
            width: 880,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                color: WHITE,
                fontSize: 32,
                fontWeight: 700,
                fontFamily: FONT,
              }}
            >
              イン崩れ指数
            </span>
            <span
              style={{
                color: WARN,
                fontSize: 76,
                fontWeight: 900,
                fontFamily: FONT,
              }}
            >
              {pct}%
            </span>
          </div>
          <div
            style={{
              marginTop: 16,
              height: 14,
              borderRadius: 7,
              background: "rgba(255,255,255,0.2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: WARN,
              }}
            />
          </div>
          <div
            style={{
              marginTop: 24,
              color: WHITE,
              fontSize: 24,
              fontFamily: FONT,
              opacity: 0.85,
              lineHeight: 1.6,
            }}
          >
            {race.volatilityReasons.slice(0, 2).map((reason) => (
              <div key={reason}>{reason}</div>
            ))}
          </div>
        </div>
      </Pop>
      <Pop delay={26} style={{ marginTop: 40, display: "flex", gap: 22 }}>
        <Mascot src={mascotSrc} size={130} />
        <div
          style={{
            color: ACCENT,
            fontSize: 38,
            fontWeight: 800,
            fontFamily: FONT,
            alignSelf: "center",
          }}
        >
          {warningReaction}
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 3: 答え合わせ（155-350f, 6.5s） ---
function SceneReveal({ mascotSrc, revealReaction, race }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.05], {
    extrapolateRight: "clamp",
  });

  const cardScale = CARD_DISPLAY_WIDTH / CARD_NATIVE_WIDTH;
  const cardDisplayHeight = race.nativeHeight * cardScale;
  const cardBottom = CARD_TOP + cardDisplayHeight;
  const highlightBox = {
    left: CARD_LEFT + race.highlightRel.x * cardScale,
    top: CARD_TOP + race.highlightRel.y * cardScale,
    width: race.highlightRel.width * cardScale,
    height: race.highlightRel.height * cardScale,
  };

  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      <PulseRings color={GREEN} size={900} top="78%" />
      <div
        style={{
          position: "absolute",
          left: CARD_LEFT,
          top: CARD_TOP,
          width: CARD_DISPLAY_WIDTH,
          transform: `scale(${kb})`,
          transformOrigin: "50% 50%",
        }}
      >
        <Img
          src={staticFile(race.screenshotFile)}
          style={{ width: "100%", display: "block", borderRadius: 24 }}
        />
      </div>
      <HighlightRing delay={20} box={highlightBox} />

      <div
        style={{
          position: "absolute",
          top: 90,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(15,44,70,0.85)",
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 26,
            padding: "12px 28px",
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
          }}
        >
          🎯 実際の龍神レーダー画面
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: cardBottom + 50,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={40}>
          <div
            style={{
              color: GREEN,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 42,
              textAlign: "center",
              textShadow: "0 4px 20px rgba(0,0,0,0.4)",
            }}
          >
            {revealReaction}
          </div>
        </Pop>
      </div>

      <div
        style={{
          position: "absolute",
          top: cardBottom + 130,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={50}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 50,
              background: "rgba(255,255,255,0.08)",
              border: `3px solid ${GREEN}`,
              borderRadius: 28,
              padding: "34px 56px",
              width: 700,
            }}
          >
            <span
              style={{
                color: WHITE,
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: 38,
              }}
            >
              払戻
            </span>
            <span
              style={{
                color: GREEN,
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: 90,
              }}
            >
              {race.payout}円
            </span>
          </div>
        </Pop>
      </div>

      <div
        style={{
          position: "absolute",
          top: cardBottom + 330,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={65}>
          <Mascot src={mascotSrc} size={260} />
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（350-425f, 2.5s） ---
function SceneCTA({ ctaLine }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, #163a5c 0%, ${NAVY} 55%, #050e18 100%)`,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <PulseRings color={GREEN} size={760} />
      <Pop delay={2}>
        <div
          style={{
            color: GREEN,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 34,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          {ctaLine}
        </div>
      </Pop>
      <Pop delay={10}>
        <Logo size={110} />
      </Pop>
      <Pop delay={20}>
        <div
          style={{
            marginTop: 40,
            padding: "20px 50px",
            borderRadius: 999,
            background: ACCENT,
            color: NAVY,
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

function MascotCM({
  mascotSrc,
  hookLine,
  warningReaction,
  revealReaction,
  ctaLine,
  race,
}) {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
      <Sequence from={0} durationInFrames={75}>
        <SceneHook mascotSrc={mascotSrc} hookLine={hookLine} />
      </Sequence>
      <Sequence from={75} durationInFrames={80}>
        <SceneWarning
          mascotSrc={mascotSrc}
          warningReaction={warningReaction}
          race={race}
        />
      </Sequence>
      <Sequence from={155} durationInFrames={195}>
        <SceneReveal
          mascotSrc={mascotSrc}
          revealReaction={revealReaction}
          race={race}
        />
      </Sequence>
      <Sequence from={350} durationInFrames={75}>
        <SceneCTA ctaLine={ctaLine} />
      </Sequence>
    </AbsoluteFill>
  );
}

// --- レースデータ（find-video-worthy-race.jsで選定、Playwrightで実画面確認済み） ---
const RACE_KOJIMA_2R = {
  raceLabel: "児島2R",
  screenshotFile: "kojima2r-result.png",
  nativeHeight: 427,
  highlightRel: { x: 1050, y: 300, width: 128, height: 65 },
  volatilityPercentile: 1.0,
  volatilityReasons: [
    "1号艇の全国勝率が非常に低い（2.69）→イン崩れリスク高",
    "AI逃げ確率が低い（32%）→まくり・差し有力",
  ],
  payout: 920,
};

const RACE_KARATSU_9R = {
  raceLabel: "唐津9R",
  screenshotFile: "race-a2-result.png",
  nativeHeight: 426,
  highlightRel: { x: 1052, y: 315, width: 104, height: 44 },
  volatilityPercentile: 0.83,
  volatilityReasons: [
    "1号艇の今節STは標準（平均0.165秒）",
    "AI逃げ確率が低い（40%）→まくり・差し有力",
  ],
  payout: 4420,
};

const RACE_EDOGAWA_5R = {
  raceLabel: "江戸川5R",
  screenshotFile: "race-a3-result.png",
  nativeHeight: 371,
  highlightRel: { x: 1044, y: 261, width: 112, height: 44 },
  volatilityPercentile: 0.86,
  volatilityReasons: [
    "AI逃げ確率が非常に低い（25%）→まくり・差しが有力",
    "1号艇の今節STが遅い（平均0.182秒）→イン崩れリスク",
  ],
  payout: 1260,
};

const RACE_MIYAJIMA_6R = {
  raceLabel: "宮島6R",
  screenshotFile: "race-b2-result.png",
  nativeHeight: 426,
  highlightRel: { x: 1051, y: 315, width: 105, height: 44 },
  volatilityPercentile: 0.92,
  volatilityReasons: [
    "1号艇の今節STは標準（平均0.167秒）",
    "1号艇の全国勝率がやや低い（4.24）→崩れやすい",
  ],
  payout: 3930,
};

const RACE_ASHIYA_7R = {
  raceLabel: "芦屋7R",
  screenshotFile: "race-b3-result.png",
  nativeHeight: 426,
  highlightRel: { x: 1044, y: 261, width: 112, height: 44 },
  volatilityPercentile: 0.96,
  volatilityReasons: [
    "AI逃げ確率が低い（39%）→まくり・差し有力",
    "1号艇の全国勝率がやや低い（4.60）→崩れやすい",
  ],
  payout: 1150,
};

const RACE_TSU_3R = {
  raceLabel: "津3R",
  screenshotFile: "race-c2-result.png",
  nativeHeight: 426,
  highlightRel: { x: 1051, y: 315, width: 105, height: 44 },
  volatilityPercentile: 0.92,
  volatilityReasons: [
    "AI逃げ確率が低い（39%）→まくり・差し有力",
    "1号艇の全国勝率がやや低い（4.55）→崩れやすい",
  ],
  payout: 2120,
};

const RACE_OMURA_9R = {
  raceLabel: "大村9R",
  screenshotFile: "race-c3-result.png",
  nativeHeight: 426,
  highlightRel: { x: 1051, y: 315, width: 105, height: 44 },
  volatilityPercentile: 0.9,
  volatilityReasons: [
    "1号艇の全国勝率が非常に低い（2.57）→イン崩れリスク高",
    "1号艇の今節STが遅い（平均0.190秒）→イン崩れリスク",
  ],
  payout: 1240,
};

const HOOK_LINES = {
  A: (
    <>
      ねえねえ、AIが
      <br />
      「これは危険」って言ってた
      <br />
      レース知ってる！？
    </>
  ),
  B: (
    <>
      先日、AIが
      <br />
      興味深い警告を出した
      <br />
      レースがあります
    </>
  ),
  C: (
    <>
      あのレースは、少し
      <br />
      荒れる予感がしていました
    </>
  ),
};

const CTA_LINE = "こういう答え合わせ、無料で見れる";

export function MascotCM_A() {
  return (
    <MascotCM
      mascotSrc="mascot-a.png"
      hookLine={HOOK_LINES.A}
      warningReaction="うわっ、まさかの100%…！"
      revealReaction="え、ガチで当たってる…！"
      ctaLine={CTA_LINE}
      race={RACE_KOJIMA_2R}
    />
  );
}

export function MascotCM_A2() {
  return (
    <MascotCM
      mascotSrc="mascot-a.png"
      hookLine={HOOK_LINES.A}
      warningReaction="えっ、83%も警戒してたの!?"
      revealReaction="うそでしょ、4,420円!?"
      ctaLine={CTA_LINE}
      race={RACE_KARATSU_9R}
    />
  );
}

export function MascotCM_A3() {
  return (
    <MascotCM
      mascotSrc="mascot-a.png"
      hookLine={HOOK_LINES.A}
      warningReaction="AIも「危ない」って言ってた…"
      revealReaction="ほんとに当ててきた…！"
      ctaLine={CTA_LINE}
      race={RACE_EDOGAWA_5R}
    />
  );
}

export function MascotCM_B() {
  return (
    <MascotCM
      mascotSrc="mascot-b.png"
      hookLine={HOOK_LINES.B}
      warningReaction="これは、見過ごせません"
      revealReaction="データは、裏切りません"
      ctaLine={CTA_LINE}
      race={RACE_KOJIMA_2R}
    />
  );
}

export function MascotCM_B2() {
  return (
    <MascotCM
      mascotSrc="mascot-b.png"
      hookLine={HOOK_LINES.B}
      warningReaction="92%。これは、見過ごせません"
      revealReaction="データは、裏切りません"
      ctaLine={CTA_LINE}
      race={RACE_MIYAJIMA_6R}
    />
  );
}

export function MascotCM_B3() {
  return (
    <MascotCM
      mascotSrc="mascot-b.png"
      hookLine={HOOK_LINES.B}
      warningReaction="96%。看過できない数値です"
      revealReaction="予測通りです"
      ctaLine={CTA_LINE}
      race={RACE_ASHIYA_7R}
    />
  );
}

export function MascotCM_C() {
  return (
    <MascotCM
      mascotSrc="mascot-c.png"
      hookLine={HOOK_LINES.C}
      warningReaction="1号艇は、少し疲れているようです"
      revealReaction="ご覧の通り。データの導きです"
      ctaLine={CTA_LINE}
      race={RACE_KOJIMA_2R}
    />
  );
}

export function MascotCM_C2() {
  return (
    <MascotCM
      mascotSrc="mascot-c.png"
      hookLine={HOOK_LINES.C}
      warningReaction="この数値、見過ごせません"
      revealReaction="ご覧の通り。データの導きです"
      ctaLine={CTA_LINE}
      race={RACE_TSU_3R}
    />
  );
}

export function MascotCM_C3() {
  return (
    <MascotCM
      mascotSrc="mascot-c.png"
      hookLine={HOOK_LINES.C}
      warningReaction="やはり、荒れる予感がしておりました"
      revealReaction="やはり、当たりましたね"
      ctaLine={CTA_LINE}
      race={RACE_OMURA_9R}
    />
  );
}
