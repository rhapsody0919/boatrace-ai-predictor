// 水平中央寄せ（translateX(-50%)）はframer-motionが管理しないstyleのdivで
// 静的に行う。motion.div自身にanimate/exitでyを動かすと、framer-motionが
// transformプロパティを自前生成の値で丸ごと上書きするため、同じstyleに
// 書いたtranslateXは反映されない（実機検証で中央からズレる現象を確認）
export function buildContainerStyle(action) {
  return {
    position: "fixed",
    bottom: action ? "92px" : "24px",
    left: "50%",
    transform: "translateX(-50%)",
    // レース詳細の下部ナビ（RaceBottomNav、z-index 1500）より上に出す。
    // tooltip（70）のままだと 375px でナビに隠れ、コピーできたか分からなかった（BOA-770）
    zIndex: 1600,
    ...(action && { width: "max-content", maxWidth: "calc(100vw - 32px)" }),
  };
}

export function pickBackground(isError, action) {
  if (isError) return "var(--color-error-dark)";
  // 白い文字が小さめでも読める濃い緑（グラデーションの明るい側だと 4.5:1 に届かない）
  if (action) return "var(--color-success-dark-text)";
  return "var(--gradient-success)";
}

export function buildToastStyle(isError, action) {
  return {
    background: pickBackground(isError, action),
    color: "#ffffff",
    padding: action ? "8px 8px 8px 16px" : "10px 20px",
    borderRadius: action ? "14px" : "9999px",
    fontSize: "14px",
    fontWeight: 600,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    whiteSpace: action ? "normal" : "nowrap",
    ...(action && {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      minHeight: "44px",
      lineHeight: 1.45,
    }),
  };
}
