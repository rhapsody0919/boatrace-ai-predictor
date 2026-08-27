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
 * 答え合わせ型（TikTok向け・マスコット無し）— 龍神レーダー Shorts
 *
 * 2026-08-24: 初日3本目として「予想数値フック型」で制作したが、締切16:25の
 * 江戸川12Rが投稿前に終了したため、結果を使った「答え合わせ型」に転換して
 * 作り直した（旧動画は削除→再投稿）。X向けLivePredictionCM.jsxはマスコット
 * 前提・実画面スクショ前提の設計だが、TikTokは(1)マスコットキャラ未使用の
 * 方針（Xの3体テスト結果待ち）、(2)実画面スクショの取得が難航したため、
 * 「イン崩れ注意度」カードをVenueRankingCMと同じ手法でテキストベース
 * 再現する方式にしている。
 *
 * 実データ: 江戸川12R（2026-08-24、締切16:25、結果確定済み）。
 * 1号艇 前田将太（A1級・全国勝率6.83）、AI逃げ確率42%、
 * イン崩れ注意度「本命有利」（会場内パーセンタイル6、実測イン崩れ率30.2%
 * vs 全体平均45.8%）。結果: 1号艇1着・決まり手「逃げ」、単勝150円。
 * AIの予想通り「本命有利」が的中した。boat-ai.jpの実画面・race_resultsの
 * 実データから数値を直接書き写した。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";
const GOLD = "#f59e0b";
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
  const x = interpolate(local, [0, 12], [40, 0], {
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

// --- Scene 1: フック（0-75f, 2.5s） ---
// カバー画像（frame=0）としても使われる。会場攻略型（VenueRankingCM.jsx）と
// 同じデザイン方針（案A: 非対称配置＋色のベタ塗り分割＋下部フック帯）を
// 答え合わせ型向けに適用（2026-08-24、デザイナーエージェント議論の結論を反映）
function SceneHook() {
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
          本日の予想検証
        </div>
      </Pop>

      {/* 主役: 巨大な「的中」。日本語2文字のため会場攻略型の1文字（560px）より
          小さくし、画面内に収まる左マージンを確保する */}
      <Pop delay={-10} style={{ position: "absolute", left: 40, top: 300 }}>
        <div
          style={{
            fontSize: 210,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.9,
            textShadow: `0 0 130px ${GOLD}aa`,
          }}
        >
          的中
        </div>
      </Pop>

      {/* レース名＋配当バッジ */}
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
            江戸川12R
          </div>
        </Pop>
        <Pop delay={-10} style={{ display: "inline-block", marginBottom: 44 }}>
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 36,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            1号艇「逃げ」的中・単勝150円
          </div>
        </Pop>

        {/* AI予想の内訳。実データの可視化として棒グラフではなくプログレスバーで表現 */}
        <Pop delay={-10}>
          <div
            style={{
              color: "rgba(248,250,252,0.6)",
              fontSize: 22,
              fontWeight: 700,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            AI予想: 1号艇の逃げ確率
          </div>
          <div
            style={{
              height: 22,
              borderRadius: 11,
              background: "rgba(255,255,255,0.1)",
              overflow: "hidden",
              marginBottom: 8,
              maxWidth: 560,
            }}
          >
            <div
              style={{
                height: "100%",
                width: "42%",
                background: GOLD,
                borderRadius: 11,
              }}
            />
          </div>
          <div
            style={{
              color: GOLD,
              fontSize: 30,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            42%
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
            }}
          >
            AIの逃げ確率、まさか42%。
            <br />
            それでも1号艇が逃げ切った
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: イン崩れ注意度カード（75-350f, 9.2s） ---
function SceneReveal() {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 64px",
        justifyContent: "center",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              color: GREEN,
              fontSize: 32,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            🎯 イン崩れ注意度
          </span>
          <span
            style={{
              background: "rgba(34,197,94,0.18)",
              color: GREEN,
              fontSize: 24,
              fontWeight: 800,
              fontFamily: FONT,
              padding: "4px 16px",
              borderRadius: 999,
            }}
          >
            本命有利
          </span>
        </div>
      </Pop>
      <Pop delay={8}>
        <div
          style={{
            color: "rgba(248,250,252,0.6)",
            fontSize: 20,
            fontFamily: FONT,
            marginBottom: 30,
          }}
        >
          過去90日・同会場のレースと比較した、1号艇が崩れやすいかどうかの相対指標
        </div>
      </Pop>

      <SlideIn delay={16}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              color: WHITE,
              fontSize: 24,
              fontFamily: FONT,
              fontWeight: 700,
            }}
          >
            会場内パーセンタイル
          </span>
          <span
            style={{
              color: GREEN,
              fontSize: 44,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            6
          </span>
        </div>
        <div
          style={{
            height: 16,
            borderRadius: 8,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              height: "100%",
              width: "6%",
              background: GREEN,
              borderRadius: 8,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "rgba(248,250,252,0.45)",
            fontSize: 16,
            fontFamily: FONT,
            marginBottom: 30,
          }}
        >
          <span>堅い</span>
          <span>標準</span>
          <span>崩れやすい</span>
        </div>
      </SlideIn>

      <SlideIn delay={30}>
        <div
          style={{
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 14,
            padding: "16px 20px",
            marginBottom: 26,
          }}
        >
          <span style={{ color: GREEN, fontSize: 20, fontFamily: FONT }}>
            📈 実測: 「本命有利」ラベルの実際のイン崩れ率は
          </span>
          <span
            style={{
              color: WHITE,
              fontSize: 24,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            {" "}
            30.2%
          </span>
          <span style={{ color: GREEN, fontSize: 20, fontFamily: FONT }}>
            {" "}
            です（全体平均45.8%）
          </span>
        </div>
      </SlideIn>

      {[
        "1号艇の今節STが速い（平均0.135秒）→ スタート安定",
        "1号艇の全国勝率が高い（6.83）→ 逃げ安定",
        "AI逃げ確率が低い（42%）→ まくり・差し有力",
      ].map((line, i) => (
        <SlideIn key={line} delay={44 + i * 10} style={{ marginBottom: 14 }}>
          <div
            style={{
              color: "rgba(248,250,252,0.85)",
              fontSize: 22,
              fontFamily: FONT,
            }}
          >
            ・{line}
          </div>
        </SlideIn>
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 2.5: 結果（300-375f, 2.5s） ---
function SceneResult() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: GOLD,
            fontSize: 32,
            fontWeight: 800,
            fontFamily: FONT,
            marginBottom: 16,
          }}
        >
          🏁 結果は…
        </div>
      </Pop>
      <Pop delay={6}>
        <div
          style={{
            color: GOLD,
            fontSize: 100,
            fontWeight: 900,
            fontFamily: FONT,
            textShadow: `0 0 60px ${GOLD}88`,
            marginBottom: 20,
          }}
        >
          的中！
        </div>
      </Pop>
      <Pop delay={12}>
        <div
          style={{
            color: WHITE,
            fontSize: 36,
            fontWeight: 800,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          1号艇「逃げ」で1着
        </div>
      </Pop>
      <Pop delay={16}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 24,
            fontFamily: FONT,
            marginTop: 8,
          }}
        >
          単勝 150円
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（375-475f, 3.3s） ---
function SceneCTA() {
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
          本日の予想、
          <br />
          無料で見れる
        </div>
      </Pop>
      <Pop delay={16} style={{ marginBottom: 40 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 24,
            fontFamily: FONT,
          }}
        >
          あなたの狙う艇は、堅い？崩れやすい？
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

export function LivePredictionCM_TikTok() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook />
      </Sequence>
      <Sequence from={75} durationInFrames={225}>
        <SceneReveal />
      </Sequence>
      <Sequence from={300} durationInFrames={75}>
        <SceneResult />
      </Sequence>
      <Sequence from={375} durationInFrames={100}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
