import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT } from "./fonts.js";

const NAVY = "#0f2c46";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";

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

// 背景の脈動リング（BOA-195で確立したパターンを流用、装飾専用）
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
        🚤
      </div>
      <span
        style={{
          color: WHITE,
          fontSize: size * 0.62,
          fontWeight: 900,
          fontFamily: FONT,
          letterSpacing: -1,
        }}
      >
        BoatAI
      </span>
    </div>
  );
}

// --- Scene 1: フック（0-70f, 2.33s）視聴者に予想させてから答えを見せる ---
function SceneHook() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 32%, #1c4a73 0%, ${NAVY} 65%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px",
        overflow: "hidden",
      }}
    >
      <PulseRings />
      <Pop delay={2}>
        <div
          style={{
            color: WHITE,
            fontSize: 50,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          この艇、1着になると思う？
        </div>
      </Pop>
      <Pop delay={26}>
        <div
          style={{
            color: WHITE,
            fontSize: 28,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
            marginTop: 20,
            opacity: 0.85,
          }}
        >
          AIの答えは
        </div>
      </Pop>
      <Pop delay={36}>
        <div
          style={{
            color: ACCENT,
            fontSize: 200,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1,
            marginTop: 4,
            textShadow: "0 8px 40px rgba(56,189,248,0.55)",
          }}
        >
          41%
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: つなぎ（60-100f, 1.33s）「え、そんなのわかるの？」 ---
function SceneBridge() {
  const frame = useCurrentFrame();
  const shake =
    Math.sin(frame * 1.2) *
    interpolate(frame, [0, 8], [3, 0], {
      extrapolateRight: "clamp",
    });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(150deg, #143752 0%, ${NAVY} 55%, #081b2c 100%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 50px",
      }}
    >
      <Pop delay={0}>
        <div
          style={{
            color: WHITE,
            fontSize: 64,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.25,
            transform: `rotate(${shake}deg)`,
          }}
        >
          え、そんなの
          <br />
          わかるの？
        </div>
      </Pop>
      <Pop delay={16}>
        <div
          style={{
            color: ACCENT,
            fontSize: 30,
            fontWeight: 800,
            fontFamily: FONT,
            marginTop: 36,
          }}
        >
          実際の画面はこちら ↓
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// クロップ設定: {scale, px, py}（px, pyはズームの中心にしたいソース動画上の座標。
// Playwrightでライブ画面のgetBoundingClientRectを実測して算出。
// .ai-analysis-body の実測幅は966pxとフレーム幅1080pxに近く、2ショットに分けて
// 大きくズームする設計は幅方向で収まらず数字が縁で切れるため、
// カード全体が確実に収まる控えめな倍率の単一クロップに統一した。
const SCREEN_CROP = { scale: 1.05, px: 540, py: 1481 };

// OffthreadVideoは巨大なwidth/height+負のleft/topを直接指定すると空白になる
// (Remotionのレンダリング上の既知の制約)。transform: scale + translateで代替する。
function ZoomedScreen({ crop }) {
  const W = 1080;
  const H = 1920;
  const translateX = W / 2 / crop.scale - crop.px;
  const translateY = H / 2 / crop.scale - crop.py;
  return (
    <div
      style={{
        width: W,
        height: H,
        transform: `scale(${crop.scale})`,
        transformOrigin: "0 0",
      }}
    >
      <div style={{ transform: `translate(${translateX}px, ${translateY}px)` }}>
        <OffthreadVideo src={staticFile("screen-clip.mp4")} />
      </div>
    </div>
  );
}

// SCREEN_CROP適用後のビューポート座標に着目させたい箇所を囲むリング
// （left/top/width/heightはSCREEN_CROPの座標系で実測調整済み）
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
        borderRadius: 20,
        opacity,
        transform: `scale(${scale})`,
        boxShadow: "0 0 0 6px rgba(245,158,11,0.25)",
      }}
    />
  );
}

// --- Scene 3: スクリーン録画（70-280f, 7s）静止クロップ+ハイライト移動 ---
function SceneScreen() {
  const frame = useCurrentFrame();
  const SWITCH_AT = 100; // 「41%」→「83」へ注目を切り替えるタイミング
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#0b1b2b", overflow: "hidden" }}>
      <ZoomedScreen crop={SCREEN_CROP} />
      {frame < SWITCH_AT ? (
        <HighlightRing
          delay={16}
          box={{ left: 874, top: 685, width: 140, height: 70 }}
        />
      ) : (
        <HighlightRing
          delay={SWITCH_AT + 4}
          box={{ left: 872, top: 1024, width: 130, height: 70 }}
        />
      )}

      {/* 上部キャプション: 何を見ているか常に明示 */}
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
          {frame < SWITCH_AT ? "🤖 AIの展開予測" : "🌪️ イン崩れ注意度"}
        </div>
      </div>

      {/* 終盤のリアクション: 情報量の多さに対する感情の起伏 */}
      {frame > durationInFrames - 55 && (
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
          <Pop delay={durationInFrames - 55}>
            <div
              style={{
                color: GREEN,
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: 34,
                textShadow: "0 4px 20px rgba(0,0,0,0.4)",
              }}
            >
              え、ここまで見えるんだ…
            </div>
          </Pop>
        </div>
      )}
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（325-390f, 2.17s） ---
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
            fontSize: 30,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 22,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          こんな予想が、全部無料で見れる
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

export function YoungPersonaCM() {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
      <Sequence from={0} durationInFrames={70}>
        <SceneHook />
      </Sequence>
      <Sequence from={70} durationInFrames={35}>
        <SceneBridge />
      </Sequence>
      <Sequence from={105} durationInFrames={210}>
        <SceneScreen />
      </Sequence>
      <Sequence from={315} durationInFrames={75}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}
