import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./RacerPageToc.css";

// 選手ページ内の目次と、絞り込みが効く節の枠（UI/UX 改善 #6、docs/design/racer-wt-uiux-2026-11/mock/approved.md）

/** 目次の項目（ページの上から下の順）。id は RacerProfileLoaded・RacerPerformanceStats の各節の外側に付ける */
const RACER_SECTIONS = [
  { id: "racer-official", label: "公式成績" },
  { id: "racer-motor", label: "モーター" },
  { id: "racer-stats", label: "成績" },
  { id: "racer-filtered", label: "調子（絞り込み）" },
  { id: "racer-race-list", label: "レース一覧" },
  { id: "racer-profile", label: "プロフィール" },
  { id: "racer-news", label: "ニュース" },
];

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// 画面に出ている節（高さがある）の id。節は非同期に届き、無いと何も描かないので DOM を見て決める
function presentSectionIds() {
  return RACER_SECTIONS.filter(
    (s) => (document.getElementById(s.id)?.offsetHeight ?? 0) > 0,
  ).map((s) => s.id);
}

function usePresentSectionIds() {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setIds((prev) => {
        const next = presentSectionIds();
        return sameList(prev, next) ? prev : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    const root = document.querySelector(".racer-profile-page") ?? document.body;
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return ids;
}

// 貼り付けの位置はヘッダー（幅で高さが変わる）の下
function useHeaderHeight() {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const header = document.querySelector(".app-header");
    if (!header) return undefined;
    const measure = () => setHeight(header.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
}

/** 節へ飛ぶ目次。実在する節だけを1行の横スクロールで出し、上に貼り付ける */
export function RacerPageToc() {
  const ids = usePresentSectionIds();
  const top = useHeaderHeight();
  const navRef = useRef(null);
  const items = RACER_SECTIONS.filter((s) => ids.includes(s.id));
  if (items.length < 2) return null;

  const jump = (event, id) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const y =
      target.getBoundingClientRect().top +
      window.scrollY -
      top -
      (navRef.current?.offsetHeight ?? 0) -
      8;
    window.scrollTo({ top: Math.max(0, y), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return (
    <nav
      ref={navRef}
      className="racer-toc"
      aria-label="このページの内容"
      style={{ top }}
    >
      <ul className="racer-toc__list">
        {items.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} onClick={(e) => jump(e, s.id)}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 絞り込みが効く節を入れる枠。上の公式成績・モーター・全体の成績には効かないことを枠の線で見せる */
export function FilterScopeFrame({ children }) {
  return (
    <section
      id="racer-filtered"
      className="racer-filter-scope"
      aria-label="絞り込みが効く成績"
    >
      <p className="racer-filter-scope__title">この枠の中は絞り込みが効きます</p>
      {children}
    </section>
  );
}
