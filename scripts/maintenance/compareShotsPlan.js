/**
 * compareShotsPlan.js - before/after の比較画像（compare-shots.js）の引数の解釈と、撮る物の並び。git にも画面にも触れない純関数。
 *
 * オーナーに画面の判断を聞くときは、前（本番）と後（手元の dev サーバー）を並べた 1100px の JPG を添える決まりがある。
 * 撮る幅・明暗・スクロールの位置を毎回手で組んでいたので、ここで1か所に決める。
 */

/** 幅ごとの画面の高さ（e2e の layout の5幅と同じ。ほかの幅は 16:10） */
const HEIGHT_BY_WIDTH = Object.freeze({ 375: 812, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 });

export const DEFAULTS = Object.freeze({
  widths: [375, 1440],
  themes: ["light"],
  scrolls: [0],
  out: "out/compare-shots",
  labelBefore: "前",
  labelAfter: "後",
});

const KNOWN = new Set(["before", "after", "paths", "widths", "themes", "scrolls", "wait", "out", "label-before", "label-after"]);

const USAGE =
  "使い方: node scripts/maintenance/compare-shots.js --before=<URL の基> --after=<URL の基> --paths=/blog,/blog/x " +
  "[--widths=375,1440] [--themes=light,dark] [--scrolls=0,2] [--wait=<CSS セレクタ>] [--out=out/compare-shots] " +
  "[--label-before=前] [--label-after=後]";

function list(value, name) {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) throw new Error(`--${name} が空。${USAGE}`);
  return items;
}

function numbers(value, name) {
  return list(value, name).map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} の「${s}」は0以上の整数でない。${USAGE}`);
    return n;
  });
}

function baseUrl(value, name) {
  if (!/^https?:\/\/[^/]+/.test(value ?? "")) throw new Error(`--${name} は http(s):// で始まる URL の基にする（今は「${value ?? ""}」）。${USAGE}`);
  return value.replace(/\/+$/, "");
}

/** argv（node と入口を除いた並び）を設定に直す。足りない・形の違う引数は理由を書いて throw */
export function parseCompareArgs(argv) {
  const raw = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!m) throw new Error(`引数「${arg}」は --名前=値 の形でない。${USAGE}`);
    if (!KNOWN.has(m[1])) throw new Error(`--${m[1]} は知らない引数（打ち間違いか）。${USAGE}`);
    raw[m[1]] = m[2];
  }
  const themes = "themes" in raw ? list(raw.themes, "themes") : DEFAULTS.themes;
  const bad = themes.find((t) => t !== "light" && t !== "dark");
  if (bad) throw new Error(`--themes の「${bad}」は light か dark にする。${USAGE}`);
  if (!raw.paths) throw new Error(`--paths が無い。${USAGE}`);
  return {
    before: baseUrl(raw.before, "before"),
    after: baseUrl(raw.after, "after"),
    paths: list(raw.paths, "paths").map((p) => (p.startsWith("/") ? p : `/${p}`)),
    widths: "widths" in raw ? numbers(raw.widths, "widths") : DEFAULTS.widths,
    themes,
    scrolls: "scrolls" in raw ? numbers(raw.scrolls, "scrolls") : DEFAULTS.scrolls,
    wait: raw.wait || null,
    out: raw.out || DEFAULTS.out,
    labelBefore: raw["label-before"] || DEFAULTS.labelBefore,
    labelAfter: raw["label-after"] || DEFAULTS.labelAfter,
  };
}

export function heightForWidth(width) {
  return HEIGHT_BY_WIDTH[width] ?? Math.round(width * 0.625);
}

/** パスをファイル名に使える形にする（"/" は top、記号は - にまとめる） */
export function slugOfPath(path) {
  const slug = path.toLowerCase().replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "top";
}

/** 撮る物の並び。1つが1枚の比較画像（前と後を1枚ずつ撮って並べる）。scroll は画面の高さの何倍まで下げるか */
export function planShots(opts) {
  const shots = [];
  for (const width of opts.widths) {
    for (const theme of opts.themes) {
      for (const path of opts.paths) {
        for (const scroll of opts.scrolls) {
          shots.push({
            path,
            width,
            height: heightForWidth(width),
            theme,
            scroll,
            file: `${slugOfPath(path)}-${width}-${theme}-s${scroll}.jpg`,
          });
        }
      }
    }
  }
  return shots;
}
