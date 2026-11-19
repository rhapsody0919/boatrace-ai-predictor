/**
 * ブログの図の契約の検査のうち、軸・行・切り替え・出典・中身（view・札・系列）の節。
 * c は blogChartChecks.js の createChecker の文脈。呼ぶ順は src/utils/blogChartContract.js の validateBlogChart。
 */
import { isObj, show } from "./blogChartChecks.js";

/** 軸。値の小数の桁と単位を返す */
export function checkAxes(c, chart, kind) {
  let decimals = 0;
  let unit = "";
  if (!isObj(chart.axes)) {
    c.err("axes", `{ ${kind.axes.join(", ")} } / 実際: ${show(chart.axes)}`);
    return { decimals, unit };
  }
  c.keysOnly(chart.axes, "axes", kind.axes);
  if (!isObj(chart.axes.category)) c.err("axes.category", "{ label } が要る");
  else {
    c.keysOnly(chart.axes.category, "axes.category", ["label"]);
    c.text(chart.axes.category.label, "axes.category.label", { max: 20 });
  }
  const va = chart.axes.value;
  if (!isObj(va)) c.err("axes.value", "{ label, unit, decimals } が要る");
  else {
    c.keysOnly(va, "axes.value", ["label", "unit", "decimals"]);
    c.text(va.label, "axes.value.label", { max: 20 });
    if (kind.units && !kind.units.includes(va.unit))
      c.err(
        "axes.value.unit",
        `${chart.kind} は ${kind.units.map((u) => `"${u}"`).join("・")} だけ / 実際: ${show(va.unit)}`,
      );
    if (!Number.isInteger(va.decimals) || va.decimals < 0 || va.decimals > 2)
      c.err("axes.value.decimals", `0〜2 の整数 / 実際: ${show(va.decimals)}`);
    decimals = Number.isInteger(va.decimals) ? va.decimals : 0;
    unit = va.unit;
  }
  return { decimals, unit };
}

/** 行。配列でなければ空の配列を返す */
export function checkRows(c, chart, kind) {
  const rows = Array.isArray(chart.rows) ? chart.rows : [];
  if (
    !Array.isArray(chart.rows) ||
    rows.length < kind.rows[0] ||
    rows.length > kind.rows[1]
  ) {
    c.err(
      "rows",
      `${kind.rows[0]}〜${kind.rows[1]}行 / 実際: ${Array.isArray(chart.rows) ? `${rows.length}行` : show(chart.rows)}`,
    );
  }
  const rowKeys = new Set();
  rows.forEach((r, i) => checkRow(c, r, `rows[${i}]`, rowKeys));
  return rows;
}

function checkRow(c, r, p, rowKeys) {
  if (!isObj(r)) return c.err(p, `{ key, label } / 実際: ${show(r)}`);
  c.keysOnly(r, p, ["key", "label", "boat"]);
  c.key(r.key, `${p}.key`);
  if (rowKeys.has(r.key)) c.err(`${p}.key`, `key の重複: ${show(r.key)}`);
  rowKeys.add(r.key);
  c.text(r.label, `${p}.label`, { max: 8 });
  if (
    r.boat !== undefined &&
    !(
      Number.isInteger(r.boat) &&
      r.boat >= 1 &&
      r.boat <= 6 &&
      String(r.boat) === r.key
    )
  ) {
    c.err(
      `${p}.boat`,
      `行の key と同じ 1〜6 の整数（艇の色の印） / 実際: ${show(r.boat)}`,
    );
  }
}

/** 切り替え */
export function checkSwitch(c, chart, views) {
  if (!("switch" in chart))
    c.err("switch", "キーは省かない。切り替えが無ければ null と書く");
  else if (chart.switch === null) {
    if (views.length !== 1)
      c.err("views", `switch が null なら1つ / 実際: ${views.length}個`);
  } else if (!isObj(chart.switch))
    c.err("switch", `null か { label, default } / 実際: ${show(chart.switch)}`);
  else {
    c.keysOnly(chart.switch, "switch", ["label", "default"]);
    c.text(chart.switch.label, "switch.label", { max: 12 });
    if (views.length < 2)
      c.err("views", `switch があれば2つ以上 / 実際: ${views.length}個`);
    if (!views.some((v) => v?.key === chart.switch.default))
      c.err(
        "switch.default",
        `views の key のどれか / 実際: ${show(chart.switch.default)}`,
      );
  }
}

/** 出典 */
export function checkSource(c, src) {
  if (!isObj(src))
    c.err("source", `{ name, dataVersion } / 実際: ${show(src)}`);
  else {
    c.keysOnly(src, "source", ["name", "dataVersion", "resultPath"]);
    c.text(src.name, "source.name", { max: 60 });
    c.date(src.dataVersion, "source.dataVersion");
    if (src.resultPath !== undefined && typeof src.resultPath !== "string")
      c.err("source.resultPath", `文字列 / 実際: ${show(src.resultPath)}`);
  }
}

/** 中身。shape は { kind, rows, decimals, unit } */
export function checkViews(c, chart, views, shape) {
  if (!Array.isArray(chart.views) || views.length === 0)
    c.err("views", "1つ以上の view が要る");
  const viewKeys = new Set();
  views.forEach((v, vi) =>
    checkView(c, chart, v, `views[${vi}]`, viewKeys, shape),
  );
}

function checkView(c, chart, v, p, viewKeys, shape) {
  if (!isObj(v))
    return c.err(p, `{ key, label, badge, series } / 実際: ${show(v)}`);
  c.keysOnly(v, p, ["key", "label", "description", "badge", "series"]);
  c.key(v.key, `${p}.key`);
  if (viewKeys.has(v.key)) c.err(`${p}.key`, `key の重複: ${show(v.key)}`);
  viewKeys.add(v.key);
  c.text(v.label, `${p}.label`, { max: 12 });
  // 切り替えのある図は、どの view を選んでも答えの1文がその view の数字になるよう、全 view で必須
  // （2026-10-20 オーナー決定。札と棒だけ替わり答えが既定の会場のままだと食い違う）
  if (isObj(chart.switch) && v.description === undefined) {
    c.err(
      `${p}.description`,
      "切り替え（switch）のある図は、全 view に答えの1文が要る（この view を選んだときに出す文）",
    );
  } else {
    c.text(v.description, `${p}.description`, { max: 90, required: false });
  }

  const sample = checkBadge(c, p, v.badge, chart.source);
  const { kind } = shape;
  const series = Array.isArray(v.series) ? v.series : [];
  if (series.length < kind.series[0] || series.length > kind.series[1]) {
    c.err(
      `${p}.series`,
      `${kind.series[0]}〜${kind.series[1]}個 / 実際: ${Array.isArray(v.series) ? series.length : show(v.series)}`,
    );
  }
  series.forEach((s, si) =>
    checkSeries(c, s, `${p}.series[${si}]`, { ...shape, sample }),
  );
}

/** 札。母数（sample.value）が正の整数ならそれを、でなければ null を返す */
function checkBadge(c, p, b, src) {
  if (!isObj(b)) {
    c.err(`${p}.badge`, "{ scope, period, sample } が要る");
    return null;
  }
  c.keysOnly(b, `${p}.badge`, ["scope", "period", "sample"]);
  c.text(b.scope, `${p}.badge.scope`, { max: 20 });
  if (!isObj(b.period)) c.err(`${p}.badge.period`, "{ from, to } が要る");
  else checkPeriod(c, p, b.period, src);
  if (!isObj(b.sample)) {
    c.err(`${p}.badge.sample`, "{ value, unit } が要る");
    return null;
  }
  let sample = null;
  c.keysOnly(b.sample, `${p}.badge.sample`, ["value", "unit"]);
  if (!Number.isInteger(b.sample.value) || b.sample.value <= 0)
    c.err(
      `${p}.badge.sample.value`,
      `正の整数 / 実際: ${show(b.sample.value)}`,
    );
  else sample = b.sample.value;
  c.text(b.sample.unit, `${p}.badge.sample.unit`, { max: 8 });
  return sample;
}

function checkPeriod(c, p, period, src) {
  c.keysOnly(period, `${p}.badge.period`, ["from", "to"]);
  c.date(period.from, `${p}.badge.period.from`);
  c.date(period.to, `${p}.badge.period.to`);
  if (period.from > period.to)
    c.err(
      `${p}.badge.period`,
      `from ≦ to / 実際: ${period.from}〜${period.to}`,
    );
  if (
    isObj(src) &&
    typeof src.dataVersion === "string" &&
    period.to > src.dataVersion
  ) {
    c.err(
      `${p}.badge.period.to`,
      `source.dataVersion（${src.dataVersion}）以前 / 実際: ${period.to}`,
    );
  }
}

/** 系列。ctx は { rows, decimals, unit, sample } */
function checkSeries(c, s, sp, ctx) {
  if (!isObj(s)) return c.err(sp, `{ key, label, values } / 実際: ${show(s)}`);
  c.keysOnly(s, sp, ["key", "label", "values", "counts", "totals"]);
  c.key(s.key, `${sp}.key`);
  c.text(s.label, `${sp}.label`, { max: 12 });
  const { rows, decimals, unit } = ctx;
  const values = Array.isArray(s.values) ? s.values : [];
  if (!Array.isArray(s.values) || values.length !== rows.length) {
    c.err(
      `${sp}.values`,
      `rows と同じ ${rows.length}個 / 実際: ${Array.isArray(s.values) ? values.length : show(s.values)}`,
    );
  }
  const scale = 10 ** decimals;
  values.forEach((x, i) => checkValue(c, x, `${sp}.values[${i}]`, ctx));
  if (unit === "%" && s.counts === undefined)
    c.err(`${sp}.counts`, "単位が % のときは counts（分子の件数）が要る");
  const counts = intArray(c, s.counts, `${sp}.counts`, rows);
  const totals = intArray(c, s.totals, `${sp}.totals`, rows);
  if (counts && unit === "%")
    counts.forEach((cnt, i) =>
      checkCount(c, sp, i, { cnt, totals, values, scale, ...ctx }),
    );
}

function checkValue(c, x, path, { decimals, unit }) {
  const scale = 10 ** decimals;
  if (typeof x !== "number" || !Number.isFinite(x))
    return c.err(path, `数 / 実際: ${show(x)}`);
  if (Math.abs(Math.round(x * scale) - x * scale) > 1e-6)
    c.err(path, `小数 ${decimals}桁まで / 実際: ${x}`);
  if (unit === "%" && (x < 0 || x > 100)) c.err(path, `0〜100 / 実際: ${x}`);
  if (x < 0) c.err(path, `0 以上（値の軸は0から） / 実際: ${x}`);
}

/** 行と同じ数の 0 以上の整数の配列なら返す。無いか誤りなら null */
function intArray(c, arr, path, rows) {
  if (arr === undefined) return null;
  if (!Array.isArray(arr) || arr.length !== rows.length) {
    c.err(path, `rows と同じ ${rows.length}個の整数 / 実際: ${show(arr)}`);
    return null;
  }
  const bad = arr.findIndex((n) => !Number.isInteger(n) || n < 0);
  if (bad >= 0) {
    c.err(`${path}[${bad}]`, `0 以上の整数 / 実際: ${show(arr[bad])}`);
    return null;
  }
  return arr;
}

/** counts と分母（totals か札の母数）から値を照合する */
function checkCount(
  c,
  sp,
  i,
  { cnt, totals, values, scale, decimals, sample },
) {
  const denom = totals ? totals[i] : sample;
  if (denom === null) return; // 札の母数の誤りは札の検査で出している
  if (denom === 0) return c.err(`${sp}.totals[${i}]`, `分母は1以上 / 実際: 0`);
  if (cnt > denom)
    return c.err(`${sp}.counts[${i}]`, `分母 ${denom} 以下 / 実際: ${cnt}`);
  const expected = Math.round((cnt * 100 * scale) / denom);
  if (
    typeof values[i] === "number" &&
    expected !== Math.round(values[i] * scale)
  ) {
    c.err(
      `${sp}.values[${i}]`,
      `counts ${cnt}/${denom} から ${(expected / scale).toFixed(decimals)} / 実際: ${values[i]}`,
    );
  }
}
