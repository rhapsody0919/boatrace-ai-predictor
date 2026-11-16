export default function ToastViewContent({ message, action, onClose, closeLabel }) {
  if (!action) return message;
  return (
    <>
      <button type="button" className="app-toast-action" onClick={action.onClick}>
        <span className="app-toast-action__message">{message}</span>
        <span className="app-toast-action__label">{action.label}</span>
      </button>
      <button type="button" className="app-toast-close" aria-label={closeLabel} onClick={onClose}>
        ×
      </button>
    </>
  );
}
