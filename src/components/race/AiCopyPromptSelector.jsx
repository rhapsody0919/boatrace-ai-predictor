import { useTranslation } from "react-i18next";
import { getAiCopyPromptOptions } from "../../utils/aiCopyPrompts";

export default function AiCopyPromptSelector({
  value,
  onChange,
  volatilityPercentile,
}) {
  const { t } = useTranslation();
  const options = getAiCopyPromptOptions(t, { volatilityPercentile });

  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        // イン崩れ注意度highのレースは選択肢が4個になり、320px幅では横一列に
        // 収まらない。折り返しを許さないとチップ内で語中改行する（「イン崩れ/狙い」）
        flexWrap: "wrap",
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
              // 折り返しはチップ単位で行う（ラベルの語中改行を避ける）
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
