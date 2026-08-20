/**
 * PredictionLoadingOverlay - AI予想ローディング演出
 * 3ステップのプログレス表示
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "./PredictionLoadingOverlay.css";

const STEPS = [
  { icon: "📊", labelKey: "loading.step1" },
  { icon: "🏁", labelKey: "loading.step2" },
  { icon: "✅", labelKey: "loading.step3" },
];

function PredictionLoadingOverlay() {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer1 = setTimeout(() => setActiveStep(1), 300);
    const timer2 = setTimeout(() => setActiveStep(2), 700);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  return (
    <div className="prediction-loading">
      <div className="prediction-loading__steps">
        {STEPS.map((step, index) => {
          const isDone = index < activeStep;
          const isActive = index === activeStep;
          const className = [
            "prediction-loading__step",
            isActive && "prediction-loading__step--active",
            isDone && "prediction-loading__step--done",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={index} className={className}>
              <span className="prediction-loading__icon">
                {isDone ? (
                  "✓"
                ) : isActive ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      stroke="var(--border-hairline)"
                      strokeWidth="1.5"
                    />
                    <line
                      x1="12"
                      y1="12"
                      x2="12"
                      y2="3"
                      stroke="var(--brand-accent-primary)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      style={{
                        transformOrigin: "12px 12px",
                        animation: "radar-sweep 1.4s linear infinite",
                      }}
                    />
                  </svg>
                ) : (
                  step.icon
                )}
              </span>
              <span className="prediction-loading__label">
                {t(step.labelKey)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PredictionLoadingOverlay;
