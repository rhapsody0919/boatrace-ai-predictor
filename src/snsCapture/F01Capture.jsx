/**
 * 完全版 f01 の撮影用の頁（/sns-capture/f01/{part}?…、docs/design/f01-stable-capture/）。
 * 本番の利用者には出さない: main.jsx がビルドの旗（VITE_SNS_CAPTURE=1、ローカルの dev サーバーだけで付ける）のときだけ読み込む。
 * 本番のビルドにはこのファイルが入らない（verify-f01-capture-contract.js がビルドの旗の分岐を確かめる）。ja 専用・noindex。
 *
 * 材料（materials.json）は撮る側（f01-capture.mjs）が頁を開く前に window.__F01_MATERIALS__ に置く（ネットへの読み取りはしない）。
 * 部品を固定の幅の箱に描き、描き終えたら箱（[data-f01-shot]）に data-f01-ready と data-f01-meta（箱の大きさ・文字・
 * 字の最小の大きさ・GOLD の枠やカーソルを置く箱）を付ける。撮る側はその箱を1回撮るだけ。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RadarBoatLegend,
  RadarFigure,
} from "../components/race/analogy/FactRadar";
import { SimilarWinBars } from "../components/race/analogy/SimilarRacesTab";
import { SankeyFigure } from "../components/race/analogy/FinishSankey";
import { SlitShapeCard } from "../components/race/analogy/SlitShapePicker";
import { FollowTable, FollowTop } from "../components/race/assist/WinFollowers";
import { SLIT_FORMS } from "../utils/analogyScenario";
import {
  F01_PARTS,
  SANKEY_VIEW,
  f01PartProps,
  sankeyFirstBox,
} from "./f01Parts";
import "../App.css";
import "../components/race/analogy/AnalogyV16.css";
import "../components/race/assist/ThinkingAssist.css";
import "./F01Capture.css";

const COMPONENTS = {
  RadarFigure,
  RadarBoatLegend,
  SimilarWinBars,
  SankeyFigure,
  SlitShapeCard,
  FollowTop,
  FollowTable,
};

/** 部品を包む本番の箱（CSS の文脈）。撮る箱（shot）は pad の余白を持つ固定の幅 */
function Wrap({ kind, shotRef, width, pad, children }) {
  if (kind === "assist")
    return (
      <div className="ta-page f01-cap-ta">
        <section
          ref={shotRef}
          data-f01-shot=""
          className="ta-box f01-cap-bare"
          style={{ width, padding: pad }}
        >
          {children}
        </section>
      </div>
    );
  const inner =
    kind === "facts" ? (
      <div className="af-hep">{children}</div>
    ) : kind === "similar" ? (
      <div className="af-tab-similar">{children}</div>
    ) : kind === "pattern" ? (
      <div className="af-pats">{children}</div>
    ) : (
      children
    );
  return (
    <section className="af-v16 f01-cap-v16">
      <div
        ref={shotRef}
        data-f01-shot=""
        className="f01-cap-shot"
        style={{ width, padding: pad }}
      >
        {inner}
      </div>
    </section>
  );
}

/** 箱の中の文字（照合用）と、文字の最小の大きさ（CSS px。svg の字は viewBox の縮尺を掛けた画面の上の大きさ） */
function textOf(root) {
  const out = [];
  const sizes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    const el = n.parentElement;
    if (
      !t ||
      !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    if (range.getBoundingClientRect().width <= 1) continue;
    out.push(t);
    const cs = getComputedStyle(el);
    const px =
      parseFloat(cs.fontSize) *
      (el instanceof SVGElement ? (el.getScreenCTM()?.a ?? 1) : 1);
    sizes.push([Math.round(px * 10) / 10, t.slice(0, 20)]);
  }
  sizes.sort((a, b) => a[0] - b[0]);
  return {
    text: out.join(" "),
    minFontPx: sizes[0]?.[0] ?? null,
    small: sizes.slice(0, 6),
  };
}

const relBox = (r, o) => ({
  x: r.x - o.x,
  y: r.y - o.y,
  w: r.width,
  h: r.height,
});

/** 6つ並ぶはずの子（艇の行・軸のボタン）。数が違えば部品の作りが変わったので止める */
const six = (els, what) => {
  if (els.length !== 6) throw new Error(`${what}が6つでない（${els.length}）`);
  return [...els];
};

/**
 * 撮る側が使う箱（箱の左上からの CSS px）。boats: 艇の行・軸のボタンの1〜6号艇、card: 形の札、cursor: 押す前の流れの1着の四角
 */
function boxesOf(part, shot, props, q) {
  const o = shot.getBoundingClientRect();
  if (part === "rows") {
    const legend = shot.querySelector(".af-hep > *");
    return {
      boats: six(legend.children, "艇の行").map((el) =>
        relBox(el.getBoundingClientRect(), o),
      ),
    };
  }
  if (part === "followTop")
    return {
      boats: six(shot.querySelectorAll('[role="radio"]'), "軸のボタン").map(
        (el) => relBox(el.getBoundingClientRect(), o),
      ),
    };
  if (part === "pattern")
    return {
      card: relBox(
        shot.querySelector(".af-pats > *").getBoundingClientRect(),
        o,
      ),
    };
  if (part === "flow" && q.get("point")) {
    const svg = shot.querySelector("svg").getBoundingClientRect();
    const s = svg.width / SANKEY_VIEW;
    const b = sankeyFirstBox(props.tri, Number(q.get("point")), props.first);
    return {
      cursor: {
        x: svg.x - o.x + b.x * s,
        y: svg.y - o.y + b.y * s,
        w: b.w * s,
        h: b.h * s,
      },
    };
  }
  return {};
}

export default function F01Capture() {
  const { t } = useTranslation();
  const shotRef = useRef(null);
  const [error, setError] = useState(null);
  const part = window.location.pathname
    .replace(/^\/sns-capture\/f01\/?/, "")
    .replace(/\/$/, "");
  const q = new URLSearchParams(window.location.search);
  const def = F01_PARTS[part];
  let props = null;
  let buildError = null;
  try {
    const m = window.__F01_MATERIALS__;
    if (!m) throw new Error("材料が無い（window.__F01_MATERIALS__）");
    // 形は名前（「横一線」等、台本の shot.form）でも渡せる
    const formName = q.get("formName");
    if (formName) {
      const key = SLIT_FORMS.find(
        (f) =>
          t(`aiPredictionTab.analogy.scenario.forms.${f}.name`) === formName,
      );
      if (!key) throw new Error(`形の名前 ${formName} が無い`);
      q.set("form", key);
    }
    if (!def) throw new Error(`撮影用の部品 ${part} は無い`);
    props = f01PartProps(part, m, q);
  } catch (e) {
    buildError = e instanceof Error ? e.message : String(e);
  }

  useLayoutEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useLayoutEffect(() => {
    const shot = shotRef.current;
    if (!shot || buildError) return;
    let live = true;
    document.fonts.ready.then(() => {
      if (!live) return;
      try {
        const r = shot.getBoundingClientRect();
        const meta = {
          part,
          w: r.width,
          h: r.height,
          ...textOf(shot),
          boxes: boxesOf(part, shot, props, q),
        };
        shot.dataset.f01Meta = JSON.stringify(meta);
        shot.dataset.f01Ready = "1";
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      live = false;
    };
  });

  const msg = buildError ?? error;
  if (msg)
    return (
      <p data-f01-error="" className="f01-cap-error">
        {msg}
      </p>
    );
  const Part = COMPONENTS[def.component];
  return (
    <Wrap
      kind={def.wrap}
      shotRef={shotRef}
      width={def.content + def.pad * 2}
      pad={def.pad}
    >
      <Part {...props} />
    </Wrap>
  );
}
