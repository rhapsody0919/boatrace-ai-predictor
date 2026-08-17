import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const DEFAULT_DURATION_MS = 2000;

export function useToast() {
  const [toast, setToast] = useState({
    visible: false,
    message: "",
    type: "success",
  });
  const timerRef = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ visible: true, message, type });
    timerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, DEFAULT_DURATION_MS);
  }, []);

  return { toast, showToast };
}

export default function Toast({ message, type = "success", visible }) {
  const isError = type === "error";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            background: isError
              ? "var(--color-error-dark)"
              : "var(--gradient-success)",
            color: "#ffffff",
            padding: "10px 20px",
            borderRadius: "9999px",
            fontSize: "14px",
            fontWeight: 600,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            zIndex: "var(--z-index-tooltip)",
            whiteSpace: "nowrap",
          }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
