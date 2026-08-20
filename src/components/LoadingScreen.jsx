import { useMemo } from "react";

const tips = [
  "1号艇の勝率は全国平均で約55%です",
  "モーター2連対率40%以上が狙い目です",
  "風速5m以上の日は外側が有利になります",
  "A1級選手は全体の20%しかいません",
  "展示航走で調子を最終確認しましょう",
  "複勝は的中率50%超えも可能です",
  "大村は1号艇勝率が全国最高（63%）です",
  "トリガミを避けるため購入額を調整しましょう",
];

const styles = {
  container: {
    padding: "3rem 2rem",
    textAlign: "center",
    background: "var(--surface-card)",
    border: "1px solid var(--border-hairline)",
    borderRadius: "12px",
    color: "var(--text-primary)",
    minHeight: "300px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  spinner: {
    marginBottom: "1.5rem",
  },
  title: {
    fontSize: "1.3rem",
    marginBottom: "1rem",
    color: "var(--text-primary)",
  },
  description: {
    fontSize: "0.95rem",
    marginBottom: "1rem",
    color: "var(--text-secondary)",
  },
  tipContainer: {
    marginTop: "1.5rem",
    padding: "1rem 1.5rem",
    background: "var(--surface-page)",
    border: "1px solid var(--border-hairline)",
    borderRadius: "8px",
    maxWidth: "400px",
  },
  tipText: {
    fontSize: "0.9rem",
    margin: 0,
    color: "var(--text-secondary)",
  },
};

// CSS keyframesをhead に注入
const injectKeyframes = () => {
  if (
    typeof document !== "undefined" &&
    !document.getElementById("loading-screen-keyframes")
  ) {
    const style = document.createElement("style");
    style.id = "loading-screen-keyframes";
    style.textContent = `
      @keyframes radar-sweep {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
};

export default function LoadingScreen({ title, description }) {
  // keyframesを注入
  injectKeyframes();

  // ランダムなTipを選択（再レンダリングで変わらないようにmemo化）
  const randomTip = useMemo(() => {
    return tips[Math.floor(Math.random() * tips.length)];
  }, []);

  return (
    <div style={styles.container}>
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        style={styles.spinner}
        role="img"
        aria-label="読み込み中"
      >
        <circle
          cx="28"
          cy="28"
          r="24"
          fill="none"
          stroke="var(--border-hairline)"
          strokeWidth="2"
        />
        <line
          x1="28"
          y1="28"
          x2="28"
          y2="6"
          stroke="var(--brand-accent-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transformOrigin: "28px 28px",
            animation: "radar-sweep 3.5s linear infinite",
          }}
        />
      </svg>
      <h3 style={styles.title}>{title || "データを読み込み中..."}</h3>
      <p style={styles.description}>
        {description || "しばらくお待ちください"}
      </p>
      <div style={styles.tipContainer}>
        <p style={styles.tipText}>💡 {randomTip}</p>
      </div>
    </div>
  );
}
