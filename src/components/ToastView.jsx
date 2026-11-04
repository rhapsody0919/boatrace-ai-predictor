import { AnimatePresence, motion } from "framer-motion";
import "./Toast.css";

/**
 * @param {{message: string, type?: "success"|"error", visible: boolean,
 *   action?: {label: string, onClick: () => void}|null,
 *   onClose?: () => void, onHold?: () => void, onRelease?: () => void, closeLabel?: string}} props
 */
export default function Toast({
  message,
  type = "success",
  visible,
  action = null,
  onClose,
  onHold,
  onRelease,
  closeLabel = "Close",
}) {
  const isError = type === "error";

  return (
    // 水平中央寄せ（translateX(-50%)）はframer-motionが管理しないstyleのdivで
    // 静的に行う。motion.div自身にanimate/exitでyを動かすと、framer-motionが
    // transformプロパティを自前生成の値で丸ごと上書きするため、同じstyleに
    // 書いたtranslateXは反映されない（実機検証で中央からズレる現象を確認）
    <div
      style={{
        position: "fixed",
        bottom: action ? "92px" : "24px",
        left: "50%",
        transform: "translateX(-50%)",
        // レース詳細の下部ナビ（RaceBottomNav、z-index 1500）より上に出す。
        // tooltip（70）のままだと 375px でナビに隠れ、コピーできたか分からなかった（BOA-770）
        zIndex: 1600,
        ...(action && { width: "max-content", maxWidth: "calc(100vw - 32px)" }),
      }}
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            role="status"
            aria-live="polite"
            onPointerEnter={action ? onHold : undefined}
            onPointerLeave={action ? onRelease : undefined}
            onFocus={action ? onHold : undefined}
            onBlur={action ? onRelease : undefined}
            style={{
              background: isError
                ? "var(--color-error-dark)"
                : action
                  ? // 白い文字が小さめでも読める濃い緑（グラデーションの明るい側だと 4.5:1 に届かない）
                    "var(--color-success-dark-text)"
                  : "var(--gradient-success)",
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
            }}
          >
            {action ? (
              <>
                <button
                  type="button"
                  className="app-toast-action"
                  onClick={action.onClick}
                >
                  <span className="app-toast-action__message">{message}</span>
                  <span className="app-toast-action__label">{action.label}</span>
                </button>
                <button
                  type="button"
                  className="app-toast-close"
                  aria-label={closeLabel}
                  onClick={onClose}
                >
                  ×
                </button>
              </>
            ) : (
              message
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
