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

function PulseRings({ color = ACCENT }) {
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
              top: "50%",
              left: "50%",
              width: 420,
              height: 420,
              marginLeft: -210,
              marginTop: -210,
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

// --- Scene 1: フック（0-70f, 2.33s）懐疑から入る「AI予想とか、話盛ってるだけっしょ」 ---
function SceneHook() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 32%, #1c4a73 0%, ${NAVY} 65%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
        overflow: "hidden",
      }}
    >
      <PulseRings />
      <Pop delay={-10}>
        <div
          style={{
            color: WHITE,
            fontSize: 52,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.35,
          }}
        >
          「AI予想とか
          <br />
          話盛ってるだけっしょ」
        </div>
      </Pop>
      <Pop delay={40}>
        <div
          style={{
            color: ACCENT,
            fontSize: 40,
            fontWeight: 800,
            fontFamily: FONT,
            marginTop: 30,
            textAlign: "center",
          }}
        >
          って思ってた。宮島のこのレースまでは。
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: つなぎ（70-115f, 1.5s）AIの予想内容を一瞬だけ見せる ---
function SceneTease() {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(150deg, #143752 0%, ${NAVY} 55%, #081b2c 100%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px",
      }}
    >
      <Pop delay={0}>
        <div
          style={{
            color: WHITE,
            fontSize: 32,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
            opacity: 0.9,
          }}
        >
          AIの予想はこう
        </div>
      </Pop>
      <Pop delay={8}>
        <div
          style={{
            color: ACCENT,
            fontSize: 58,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginTop: 12,
          }}
        >
          1号艇が「逃げ」41%
        </div>
      </Pop>
      <Pop delay={24}>
        <div
          style={{
            color: WHITE,
            fontSize: 36,
            fontWeight: 800,
            fontFamily: FONT,
            marginTop: 24,
          }}
        >
          で、実際は…？
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// カード画像上でのハイライト位置(カード表示位置・拡大率から算出、実測座標ベース)
const CARD_DISPLAY_WIDTH = 980;
const CARD_NATIVE_WIDTH = 968;
const CARD_NATIVE_HEIGHT = 403;
const CARD_SCALE = CARD_DISPLAY_WIDTH / CARD_NATIVE_WIDTH;
const CARD_DISPLAY_HEIGHT = CARD_NATIVE_HEIGHT * CARD_SCALE;
const CARD_LEFT = (1080 - CARD_DISPLAY_WIDTH) / 2;
const CARD_TOP = (1920 - CARD_DISPLAY_HEIGHT) / 2;

// 「41%」+「的中」バッジ周辺(カード相対座標: x840,y185,w105,h40 に余白を足したもの)
const HIGHLIGHT_REL = { x: 840, y: 178, width: 115, height: 55 };
const HIGHLIGHT_BOX = {
  left: CARD_LEFT + HIGHLIGHT_REL.x * CARD_SCALE,
  top: CARD_TOP + HIGHLIGHT_REL.y * CARD_SCALE,
  width: HIGHLIGHT_REL.width * CARD_SCALE,
  height: HIGHLIGHT_REL.height * CARD_SCALE,
};

function HighlightRing({ delay = 0 }) {
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
        ...HIGHLIGHT_BOX,
        border: "6px solid #f59e0b",
        borderRadius: 20,
        opacity,
        transform: `scale(${scale})`,
        boxShadow: "0 0 0 6px rgba(245,158,11,0.25)",
      }}
    />
  );
}

// --- Scene 2: 答え合わせ（75-270f, 6.5s）実際の「レース結果」カードを表示 ---
function SceneReveal() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.06], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
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
          src={staticFile("hitcheck-card.png")}
          style={{ width: "100%", display: "block", borderRadius: 24 }}
        />
      </div>
      <HighlightRing delay={20} />

      <div
        style={{
          position: "absolute",
          top: 40,
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
            padding: "10px 24px",
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
          bottom: 60,
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
              fontSize: 38,
              textShadow: "0 4px 20px rgba(0,0,0,0.4)",
            }}
          >
            え、ガチで当たってる…
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（270-390f, 4s） ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, #163a5c 0%, ${NAVY} 55%, #050e18 100%)`,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <PulseRings color={GREEN} />
      <Pop delay={2}>
        <div
          style={{
            color: GREEN,
            fontSize: 32,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 22,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          こういう答え合わせ、無料で見れる
        </div>
      </Pop>
      <Pop delay={10}>
        <Logo size={80} />
      </Pop>
      <Pop delay={20}>
        <div
          style={{
            marginTop: 28,
            padding: "16px 40px",
            borderRadius: 999,
            background: ACCENT,
            color: NAVY,
            fontSize: 32,
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

export function HitCheckCM() {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
      <Sequence from={0} durationInFrames={70}>
        <SceneHook />
      </Sequence>
      <Sequence from={70} durationInFrames={45}>
        <SceneTease />
      </Sequence>
      <Sequence from={115} durationInFrames={200}>
        <SceneReveal />
      </Sequence>
      <Sequence from={315} durationInFrames={75}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}
