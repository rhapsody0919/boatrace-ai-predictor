/**
 * ブログの図の契約（docs/design/blog-charts/contract.md、schemaVersion 1）の検査と読み出し。
 * 部品（src/components/blog/BlogChart.jsx）と CI（scripts/maintenance/verify-blog-charts.js）が同じ関数を使う。
 * 検査は最初の1件で止めず、全件を { path, message } の配列で返す（作り手の LLM が1回で直せるように）。
 */

import { createChecker, isObj, show } from "../pure/blogChartChecks.js";
import {
  checkAxes,
  checkRows,
  checkSwitch,
  checkSource,
  checkViews,
} from "../pure/blogChartSections.js";
import { checkAnswers } from "../pure/blogChartAnswers.js";

export { localize } from "../pure/blogChartChecks.js";

export const SCHEMA_VERSION = 1;
export const LANGS = ["ja", "en", "zh-TW", "ko"];

/** 種類ごとの決まり。予約の種類は implemented: false（検査で「未実装」として落とす） */
export const KINDS = {
  hbar: {
    implemented: true,
    axes: ["category", "value"],
    rows: [2, 12],
    series: [1, 1],
    // 値は棒の右の決まった幅に出すので、単位は「%」だけ（長い単位・大きい整数は収まらない）
    units: ["%"],
  },
  vbar: { implemented: false },
  stacked: { implemented: false },
  line: { implemented: false },
  scatter: { implemented: false },
  table: { implemented: false },
};

const BANNED_WORDS = ["競艇"];

/** 値の軸の最大。全 view・全系列の最大を 10 の倍数に切り上げる（切り替えても棒の長さを比べられるように） */
export function valueAxisMax(chart) {
  const max = Math.max(
    0,
    ...chart.views.flatMap((v) => v.series.flatMap((s) => s.values)),
  );
  return chart.axes.value.unit === "%"
    ? Math.min(100, Math.max(10, Math.ceil(max / 10) * 10))
    : Math.max(1, Math.ceil(max / 10) * 10);
}

/**
 * @param {unknown} chart 読み込んだ JSON
 * @param {{ langs?: string[] }} [opts] langs: この JSON を参照する記事の言語（ja 以外が入るとその言語の文字を必須にする）
 * @returns {{ path: string, message: string }[]} 空なら契約どおり
 */
export function validateBlogChart(chart, { langs = ["ja"] } = {}) {
  const c = createChecker({
    langs,
    allLangs: LANGS,
    bannedWords: BANNED_WORDS,
  });
  if (!isObj(chart))
    return [
      { path: "", message: `JSON のオブジェクト / 実際: ${show(chart)}` },
    ];

  c.keysOnly(chart, "", [
    "schemaVersion",
    "id",
    "article",
    "kind",
    "title",
    "description",
    "axes",
    "rows",
    "switch",
    "views",
    "source",
    "note",
  ]);
  if (chart.schemaVersion !== SCHEMA_VERSION)
    c.err(
      "schemaVersion",
      `${SCHEMA_VERSION} / 実際: ${show(chart.schemaVersion)}`,
    );
  c.key(chart.id, "id");
  c.key(chart.article, "article");

  const kind = KINDS[chart.kind];
  if (!kind) {
    c.err(
      "kind",
      `${Object.keys(KINDS).join("・")} のどれか / 実際: ${show(chart.kind)}`,
    );
    return c.errors;
  }
  if (!kind.implemented) {
    c.err(
      "kind",
      `「${chart.kind}」は契約に予約しただけで未実装。Linear に「ブログの図の種類の追加」を起票する`,
    );
    return c.errors;
  }

  c.text(chart.title, "title", { max: 40 });
  c.text(chart.description, "description", { max: 90 });
  c.text(chart.note, "note", { max: 70, required: false });

  const { decimals, unit } = checkAxes(c, chart, kind);
  const rows = checkRows(c, chart, kind);
  const views = Array.isArray(chart.views) ? chart.views : [];
  checkSwitch(c, chart, views);
  checkSource(c, chart.source);
  checkViews(c, chart, views, { kind, rows, decimals, unit });
  checkAnswers(c, chart, views);
  return c.errors;
}
