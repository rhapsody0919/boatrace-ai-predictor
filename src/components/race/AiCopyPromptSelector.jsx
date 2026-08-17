import { useTranslation } from "react-i18next";
import { getAiCopyPromptOptions } from "../../utils/aiCopyPrompts";

export default function AiCopyPromptSelector({ value, onChange }) {
  const { t } = useTranslation();
  const options = getAiCopyPromptOptions(t);

  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        gap: "4px",
        background: "var(--color-primary-alpha-10)",
        borderRadius: "var(--radius-md)",
        padding: "3px",
      }}
    >
      {options.map((option) => {
        const selected = option.type === value;
        return (
          <button
            key={option.type}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.type)}
            style={{
              border: "none",
              cursor: "pointer",
              padding: "4px 12px",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              background: selected ? "var(--color-primary-500)" : "transparent",
              color: selected ? "#ffffff" : "var(--color-primary-600)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
