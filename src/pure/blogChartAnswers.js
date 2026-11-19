/**
 * ブログの図の契約の検査のうち、答えの文（description）の数字の照合。
 * c は blogChartChecks.js の createChecker の文脈。src/utils/blogChartContract.js の validateBlogChart の最後に呼ぶ。
 */
import { isObj, show, localize } from "./blogChartChecks.js";

// 答えの数字は、その view か全国（all）の値だけ
const numbersIn = (t) =>
  // 全角の数字・％も拾う（半角だけ見ると全角で書いた写し間違いが通る）
  [
    ...localize(t, "ja")
      .replace(/[０-９．]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      )
      .matchAll(/(\d+(?:\.\d+)?)[%％]/g),
  ].map((m) => Number(m[1]));

// 答えの文の「N（単位）中 M 回」は、その view か全国の母数（badge.sample）と件数（counts）の組だけ。
// % だけを照合すると、母数・回数の写し間違い（2,256→2,265 等）が通る
const pairsIn = (t) =>
  [
    ...localize(t, "ja")
      .replace(/[０-９，]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
      )
      .matchAll(/([\d,]+)[^\d（）()、。]{0,6}中([\d,]+)回/g),
  ].map((m) => [
    Number(m[1].replaceAll(",", "")),
    Number(m[2].replaceAll(",", "")),
  ]);

const allowedNumbers = (views, view) =>
  new Set(
    [view, views.find((v) => v?.key === "all")]
      .filter(isObj)
      .flatMap((v) =>
        (Array.isArray(v.series) ? v.series : []).flatMap((s) =>
          Array.isArray(s?.values) ? s.values : [],
        ),
      ),
  );

const pairsOfSeries = (v, s) =>
  (Array.isArray(s?.counts) ? s.counts : []).map((c, i) => {
    const total = Array.isArray(s.totals)
      ? s.totals[i]
      : v.badge?.sample?.value;
    return `${total}:${c}`;
  });

const allowedPairs = (views, view) =>
  new Set(
    [view, views.find((v) => v?.key === "all")]
      .filter(isObj)
      .flatMap((v) =>
        (Array.isArray(v.series) ? v.series : []).flatMap((s) =>
          pairsOfSeries(v, s),
        ),
      ),
  );

/** 答えの文の数字と「N…中M回」の組を、図の中の値と照合する */
export function checkAnswers(c, chart, views) {
  // 切り替えのある図は、最上位の答え（本文との照合・画像の代替テキストに使う）を既定の view の答えと同じにする。
  // 片方だけ直すと、画面の文と本文・画像の文が食い違う
  if (isObj(chart.switch)) {
    const dv = views.find((v) => v?.key === chart.switch.default);
    if (
      isObj(dv) &&
      dv.description !== undefined &&
      JSON.stringify(dv.description) !== JSON.stringify(chart.description)
    ) {
      c.err(
        "description",
        `既定の view（${chart.switch.default}）の description と同じ文にする / 実際: ${show(chart.description)}`,
      );
    }
  }
  // 会場どうしを比べる答えも書けるよう、どの view の組でもよい（数字の写し間違いを拾うのが目的）
  const everyPair = new Set(
    views.filter(isObj).flatMap((v) => [...allowedPairs(views, v)]),
  );
  const pairMsg = (n, m) =>
    `「${n.toLocaleString("ja-JP")}…中${m.toLocaleString("ja-JP")}回」は図の中の母数と counts の組だけ`;
  eachViewDescription(views, (v, vi) => {
    for (const [n, m] of pairsIn(v.description)) {
      if (!everyPair.has(`${n}:${m}`))
        c.err(`views[${vi}].description`, pairMsg(n, m));
    }
  });
  for (const [n, m] of pairsIn(chart.description)) {
    if (!everyPair.has(`${n}:${m}`)) c.err("description", pairMsg(n, m));
  }
  // 最上位の答えは、図の中の値（会場どうしの比べを含む）だけ。数字の写し間違いを拾う
  const everyNumber = new Set(
    views.filter(isObj).flatMap((v) => [...allowedNumbers(views, v)]),
  );
  for (const n of numbersIn(chart.description)) {
    if (!everyNumber.has(n))
      c.err("description", `数字は views のどれかの値だけ / 実際: ${n}%`);
  }
  eachViewDescription(views, (v, vi) => {
    for (const n of numbersIn(v.description)) {
      if (!everyNumber.has(n))
        c.err(
          `views[${vi}].description`,
          `数字は views のどれかの値だけ / 実際: ${n}%`,
        );
    }
  });
}

function eachViewDescription(views, fn) {
  views.forEach((v, vi) => {
    if (!isObj(v) || v.description === undefined) return;
    fn(v, vi);
  });
}
