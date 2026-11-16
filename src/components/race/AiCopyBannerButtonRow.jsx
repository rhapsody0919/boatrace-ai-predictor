import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import AiCopyButton from "./AiCopyButton";

// 脈動リングを時間差で2重に描画し、ping通知のような目立つ演出にする。
// 常時脈動はうるさいので、表示直後に数回だけ鳴らして止める（BOA-770 推奨11）
const PING_RINGS = [0, 0.7];
const PING_REPEAT = 2;

export default function AiCopyBannerButtonRow({
  raceId,
  prediction,
  race,
  venueCode,
  promptType,
  onCopy,
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        // 320px幅では「コピーボタン + キャッチコピーバッジ」（どちらもnowrapで
        // 縮まない）が横一列に収まらず、このラッパーが親（.ai-copy-banner、
        // 内容幅262px）からあふれてページ全体を横スクロールさせていた。
        // 折り返しを許すと必要幅が max(ボタン, バッジ) まで落ちて収まる。
        // min-width:0は付けない（自動最小サイズが外れ、バッジ単体すら入らない
        // 極端な狭さ〈viewport 200px未満〉で再びあふれるため）
        flexWrap: "wrap",
      }}
    >
      {/* ボタン自体は静止させ、背後にping通知風の脈動リングだけを重ねる
          （ボタンをscaleさせるとPlaywrightのactionability判定が
          「element is not stable」で失敗し続けるだけでなく、実クリック時の
          座標もフレームごとにずれるため、装飾要素として分離した）。
          リングのラッパーはボタンだけを子に持つ（キャッチコピーバッジを
          含めると脈動範囲がバッジまで広がってしまうため） */}
      <div style={{ position: "relative", display: "inline-block" }}>
        {!prefersReducedMotion &&
          PING_RINGS.map((delay) => (
            <motion.span
              key={delay}
              aria-hidden="true"
              animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
              transition={{
                duration: 1.4,
                repeat: PING_REPEAT,
                ease: "easeOut",
                delay,
              }}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "var(--radius-md)",
                background: "var(--color-primary-500)",
                zIndex: 0,
                pointerEvents: "none",
              }}
            />
          ))}
        <div style={{ position: "relative", zIndex: 1 }}>
          <AiCopyButton
            variant="banner"
            raceId={raceId}
            prediction={prediction}
            race={race}
            venueCode={venueCode}
            promptType={promptType}
            onCopy={onCopy}
          />
        </div>
      </div>
      {/* 以前は上下に跳ね続けていたが、うるさいので止めた（BOA-770 推奨11） */}
      <span
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 700,
          color: "var(--color-primary-700)",
          background: "#ffffff",
          padding: "3px 10px",
          borderRadius: "9999px",
          whiteSpace: "nowrap",
        }}
      >
        {t("aiCopy.bannerCatchphrase")}
      </span>
    </div>
  );
}
