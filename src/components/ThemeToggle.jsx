import { useTheme } from "../hooks/useTheme";
import { THEMES } from "../config/theme";
import "./ThemeToggle.css";

function getEffectiveTheme(theme) {
  if (theme) return theme;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? THEMES.DARK
      : THEMES.LIGHT;
  }
  return THEMES.LIGHT;
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = getEffectiveTheme(theme) === THEMES.DARK;

  const handleClick = () => {
    setTheme(isDark ? THEMES.LIGHT : THEMES.DARK);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={handleClick}
      aria-label={isDark ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
      title={isDark ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
    >
      {isDark ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22" />
          <line x1="4" y1="12" x2="2" y2="12" />
          <line x1="22" y1="12" x2="20" y2="12" />
          <line x1="5" y1="5" x2="6.5" y2="6.5" />
          <line x1="17.5" y1="17.5" x2="19" y2="19" />
          <line x1="5" y1="19" x2="6.5" y2="17.5" />
          <line x1="17.5" y1="6.5" x2="19" y2="5" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.5A9 9 0 1 1 11.5 3a7 7 0 0 0 9.5 9.5z" />
        </svg>
      )}
    </button>
  );
}

export default ThemeToggle;
