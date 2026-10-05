import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import AiCopyPromptSelector from "./AiCopyPromptSelector";
import AiCopyButton from "./AiCopyButton";
import { useAiCopyText } from "../../hooks/useAiCopyText";

// 脈動リングを時間差で2重に描画し、ping通知のような目立つ演出にする。
// 常時脈動はうるさいので、表示直後に数回だけ鳴らして止める（BOA-770 推奨11）
const PING_RINGS = [0, 0.7];
const PING_REPEAT = 2;

const FOLLOW_UP_KEYS = ["aiCopy.followUp1", "aiCopy.followUp2", "aiCopy.followUp3"];

export default function AiCopyBanner({
  raceId,
  prediction,
  race,
  venueCode,
  promptType,
  onPromptTypeChange,
  onCopy,
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const [previewOpen, setPreviewOpen] = useState(false);
  // AiCopyButton自体もisReadyで自身を隠すが、バナーの他要素
  // （バッジ・券種セレクタ・プレビュー開閉）だけが先に表示され、
  // 肝心のボタンだけ無いという壊れて見える状態を避けるため、
  // バナー全体をisReadyでゲートする（同じキャッシュ済みフックの再呼び出しのため
  // 追加のデータ取得コストは発生しない）
  const { isReady, buildText } = useAiCopyText({
    raceId,
    prediction,
    race,
    venueCode,
  });

  if (!isReady) return null;

  return (
    <div
      className="ai-copy-banner"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "10px",
        background: "var(--color-primary-alpha-10)",
        border: "1px solid var(--color-primary-alpha-30)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px",
        marginBottom: "1rem",
      }}
    >
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
      <AiCopyPromptSelector
        value={promptType}
        onChange={onPromptTypeChange}
        volatilityPercentile={prediction?.volatilityPercentile}
      />

      <button
        type="button"
        onClick={() => setPreviewOpen((prev) => !prev)}
        aria-expanded={previewOpen}
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "var(--color-primary-700)",
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: previewOpen ? "rotate(90deg)" : "none",
          }}
        >
          ▸
        </span>
        {t("aiCopy.previewToggleLabel")}
      </button>
      <AnimatePresence>
        {previewOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ width: "100%", minWidth: 0, overflow: "hidden" }}
          >
            {/* コピーされる全文（表・注記・出典を含む、BOA-770 推奨9）。表は横に長いので
                この箱の中だけで横スクロールさせ、ページ全体をはみ出させない */}
            <pre
              data-testid="ai-copy-preview"
              style={{
                margin: "8px 0 0",
                padding: "10px 12px",
                background: "#ffffff",
                border: "1px solid var(--color-primary-alpha-30)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-xs)",
                color: "var(--color-gray-700)",
                lineHeight: 1.6,
                maxHeight: "320px",
                overflow: "auto",
                whiteSpace: "pre",
                fontFamily: "inherit",
              }}
            >
              {buildText(promptType)}
            </pre>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                color: "var(--color-gray-700)",
              }}
            >
              {t("aiCopy.followUpHeading")}
            </p>
            <ul
              style={{
                margin: "4px 0 0",
                paddingLeft: "1.25rem",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-gray-600)",
                lineHeight: 1.6,
              }}
            >
              {FOLLOW_UP_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
