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

// --- Scene 1: フック（0-65f, 2.17s） ---
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
      <Pop delay={2}>
        <div
          style={{
            color: WHITE,
            fontSize: 46,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.35,
          }}
        >
          無料のボートレースサイトに
        </div>
      </Pop>
      <Pop delay={22}>
        <div
          style={{
            color: ACCENT,
            fontSize: 96,
            fontWeight: 900,
            fontFamily: FONT,
            marginTop: 10,
            textShadow: "0 8px 40px rgba(56,189,248,0.55)",
          }}
        >
          分析ツール17個
        </div>
      </Pop>
      <Pop delay={40}>
        <div
          style={{
            color: WHITE,
            fontSize: 34,
            fontWeight: 800,
            fontFamily: FONT,
            marginTop: 16,
          }}
        >
          って、知ってた？
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: 証拠（65-135f, 2.33s）実際のツール一覧を見せる ---
function SceneProof() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.05], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        padding: "0 40px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={0}>
          <div
            style={{
              color: ACCENT,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 30,
            }}
          >
            🎯 これ、全部無料で使える
          </div>
        </Pop>
      </div>
      <div style={{ transform: `scale(${kb})`, width: "100%" }}>
        <Img
          src={staticFile("toolgrid-card.png")}
          style={{ width: "100%", display: "block", borderRadius: 16 }}
        />
      </div>
    </AbsoluteFill>
  );
}

// スクリーンショットの上部（ナビ+タブ+見出し+グラフ冒頭）を見せる。
// screenshotは1080x1920のビューポート単位（フレームと完全に同じ幅）で撮影済みなので
// 横方向には一切ズーム・拡大しない（scale=1固定）。タブ行はほぼフル幅にラベルが
// 並んでいるため、わずかな拡大でも端のタブ名が切れる（実際に1.15倍でも「会場ランキング」
// 等が見切れる問題が発生した教訓）。縦方向のみ表示位置をずらして見せる範囲を変える。
function ZoomedTool({ src, delay = 0 }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const offsetY = interpolate(local, [0, 55], [-70, -110], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width: 1080,
          display: "block",
          position: "absolute",
          top: offsetY,
          left: 0,
        }}
      />
    </div>
  );
}

function ToolSlide({ src, label, desc, delay = 0 }) {
  return (
    <AbsoluteFill style={{ background: "#0b1b2b", overflow: "hidden" }}>
      <ZoomedTool src={src} delay={delay} />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "40px 50px 90px",
          background:
            "linear-gradient(to top, rgba(11,27,43,0.98) 30%, rgba(11,27,43,0))",
        }}
      >
        <Pop delay={delay + 3}>
          <div
            style={{
              color: ACCENT,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 40,
            }}
          >
            {label}
          </div>
          <div
            style={{
              color: WHITE,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 24,
              marginTop: 8,
              opacity: 0.9,
            }}
          >
            {desc}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: モンタージュ（135-300f, 5.5s）3つのツールを高速で見せる ---
function SceneMontage() {
  const frame = useCurrentFrame();
  const SLIDE = 55;
  if (frame < SLIDE) {
    return (
      <ToolSlide
        src="tool-kimarite.png"
        label="🎯 決まり手データ分析"
        desc="会場・枠番ごとの必勝パターンが一発でわかる"
        delay={0}
      />
    );
  }
  if (frame < SLIDE * 2) {
    return (
      <ToolSlide
        src="tool-motor.png"
        label="🔧 モーター調子"
        desc="今日のレースのモーター2連率が一覧に"
        delay={SLIDE}
      />
    );
  }
  return (
    <ToolSlide
      src="tool-topstart.png"
      label="🚀 トップスタート分析"
      desc="どの枠が本当に速いか、数字で丸わかり"
      delay={SLIDE * 2}
    />
  );
}

// --- Scene 4: CTA（300-390f, 3s） ---
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
          これが全部、無料。
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

export function ToolShowcaseCM() {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
      <Sequence from={0} durationInFrames={65}>
        <SceneHook />
      </Sequence>
      <Sequence from={65} durationInFrames={70}>
        <SceneProof />
      </Sequence>
      <Sequence from={135} durationInFrames={165}>
        <SceneMontage />
      </Sequence>
      <Sequence from={300} durationInFrames={90}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}
