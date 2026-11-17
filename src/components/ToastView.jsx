import { AnimatePresence, motion } from "framer-motion";
import "./Toast.css";
import ToastViewContent from "./ToastViewContent.jsx";
import { buildContainerStyle, buildToastStyle } from "./ToastViewLogic.js";

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
    <div style={buildContainerStyle(action)}>
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
            style={buildToastStyle(isError, action)}
          >
            <ToastViewContent
              message={message}
              action={action}
              onClose={onClose}
              closeLabel={closeLabel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
