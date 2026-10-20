/**
 * ブログの図の契約（docs/design/blog-charts/contract.md、schemaVersion 1）の検査と読み出し。
 * 部品（src/components/blog/BlogChart.jsx）と CI（scripts/maintenance/verify-blog-charts.js）が同じ関数を使う。
 * 検査は最初の1件で止めず、全件を { path, message } の配列で返す（作り手の LLM が1回で直せるように）。
 */

export const SCHEMA_VERSION = 1;
export const LANGS = ["ja", "en", "zh-TW", "ko"];

/** 種類ごとの決まり。予約の種類は implemented: false（検査で「未実装」として落とす） */
export const KINDS = {
  hbar: {
    implemented: true,
    axes: ["category", "value"],
    rows: [2, 12],
    series: [1, 1],
  },
  vbar: { implemented: false },
  stacked: { implemented: false },
  line: { implemented: false },
  scatter: { implemented: false },
  table: { implemented: false },
};

const BANNED_WORDS = ["競艇"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v) => (v === undefined ? "（無し）" : JSON.stringify(v));

/** 文字列か { ja, en, ... } を、その言語の文字にする。無ければ ja */
export function localize(text, lang = "ja") {
  if (typeof text === "string") return text;
  if (isObj(text)) return text[lang] ?? text.ja;
  return "";
}

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
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  const keysOnly = (obj, path, allowed) => {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k))
        err(
          `${path}.${k}`.replace(/^\./, ""),
          `契約に無いキー（使えるのは ${allowed.join("・")}）`,
        );
    }
  };
  const text = (v, path, { min = 1, max, required = true } = {}) => {
    if (v === undefined && !required) return;
    const variants = typeof v === "string" ? { ja: v } : v;
    if (!isObj(variants) || typeof variants.ja !== "string") {
      err(path, `文字列か { "ja": "…" } / 実際: ${show(v)}`);
      return;
    }
    keysOnly(variants, path, LANGS);
    if (typeof v !== "string") {
      for (const lang of langs.filter((l) => l !== "ja")) {
        if (typeof variants[lang] !== "string")
          err(
            `${path}.${lang}`,
            `${lang} の記事から参照されるので ${lang} の文字が要る`,
          );
      }
    } else if (langs.some((l) => l !== "ja")) {
      err(
        path,
        `${langs.filter((l) => l !== "ja").join("・")} の記事から参照されるので { "ja": …, "${langs.find((l) => l !== "ja")}": … } で書く`,
      );
    }
    for (const [lang, s] of Object.entries(variants)) {
      if (typeof s !== "string") continue;
      const len = [...s].length;
      if (len < min || (max && len > max))
        err(
          `${path}${typeof v === "string" ? "" : `.${lang}`}`,
          `${min}〜${max ?? "∞"}字 / 実際: ${len}字`,
        );
      for (const w of BANNED_WORDS)
        if (s.includes(w)) err(path, `「${w}」は図に書かない（画面に出る）`);
    }
  };
  const key = (v, path) => {
    if (typeof v !== "string" || v === "")
      err(path, `文字列の key / 実際: ${show(v)}`);
  };
  const date = (v, path) => {
    if (
      typeof v !== "string" ||
      !DATE_RE.test(v) ||
      Number.isNaN(Date.parse(v))
    )
      err(path, `YYYY-MM-DD / 実際: ${show(v)}`);
  };

  if (!isObj(chart))
    return [
      { path: "", message: `JSON のオブジェクト / 実際: ${show(chart)}` },
    ];

  keysOnly(chart, "", [
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
    err(
      "schemaVersion",
      `${SCHEMA_VERSION} / 実際: ${show(chart.schemaVersion)}`,
    );
  key(chart.id, "id");
  key(chart.article, "article");

  const kind = KINDS[chart.kind];
  if (!kind) {
    err(
      "kind",
      `${Object.keys(KINDS).join("・")} のどれか / 実際: ${show(chart.kind)}`,
    );
    return errors;
  }
  if (!kind.implemented) {
    err(
      "kind",
      `「${chart.kind}」は契約に予約しただけで未実装。Linear に「ブログの図の種類の追加」を起票する`,
    );
    return errors;
  }

  text(chart.title, "title", { max: 40 });
  text(chart.description, "description", { max: 120 });
  text(chart.note, "note", { max: 80, required: false });

  // 軸
  let decimals = 0;
  let unit = "";
  if (!isObj(chart.axes)) {
    err("axes", `{ ${kind.axes.join(", ")} } / 実際: ${show(chart.axes)}`);
  } else {
    keysOnly(chart.axes, "axes", kind.axes);
    if (!isObj(chart.axes.category)) err("axes.category", "{ label } が要る");
    else {
      keysOnly(chart.axes.category, "axes.category", ["label"]);
      text(chart.axes.category.label, "axes.category.label", { max: 20 });
    }
    const va = chart.axes.value;
    if (!isObj(va)) err("axes.value", "{ label, unit, decimals } が要る");
    else {
      keysOnly(va, "axes.value", ["label", "unit", "decimals"]);
      text(va.label, "axes.value.label", { max: 20 });
      if (typeof va.unit !== "string")
        err(
          "axes.value.unit",
          `文字列（例 "%"、単位が無ければ ""） / 実際: ${show(va.unit)}`,
        );
      if (!Number.isInteger(va.decimals) || va.decimals < 0 || va.decimals > 2)
        err("axes.value.decimals", `0〜2 の整数 / 実際: ${show(va.decimals)}`);
      decimals = Number.isInteger(va.decimals) ? va.decimals : 0;
      unit = va.unit;
    }
  }

  // 行
  const rows = Array.isArray(chart.rows) ? chart.rows : [];
  if (
    !Array.isArray(chart.rows) ||
    rows.length < kind.rows[0] ||
    rows.length > kind.rows[1]
  ) {
    err(
      "rows",
      `${kind.rows[0]}〜${kind.rows[1]}行 / 実際: ${Array.isArray(chart.rows) ? `${rows.length}行` : show(chart.rows)}`,
    );
  }
  const rowKeys = new Set();
  rows.forEach((r, i) => {
    const p = `rows[${i}]`;
    if (!isObj(r)) return err(p, `{ key, label } / 実際: ${show(r)}`);
    keysOnly(r, p, ["key", "label", "boat"]);
    key(r.key, `${p}.key`);
    if (rowKeys.has(r.key)) err(`${p}.key`, `key の重複: ${show(r.key)}`);
    rowKeys.add(r.key);
    text(r.label, `${p}.label`, { max: 12 });
    if (
      r.boat !== undefined &&
      !(
        Number.isInteger(r.boat) &&
        r.boat >= 1 &&
        r.boat <= 6 &&
        String(r.boat) === r.key
      )
    ) {
      err(
        `${p}.boat`,
        `行の key と同じ 1〜6 の整数（艇の色の印） / 実際: ${show(r.boat)}`,
      );
    }
  });

  // 切り替え
  const views = Array.isArray(chart.views) ? chart.views : [];
  if (!("switch" in chart))
    err("switch", "キーは省かない。切り替えが無ければ null と書く");
  else if (chart.switch === null) {
    if (views.length !== 1)
      err("views", `switch が null なら1つ / 実際: ${views.length}個`);
  } else if (!isObj(chart.switch))
    err("switch", `null か { label, default } / 実際: ${show(chart.switch)}`);
  else {
    keysOnly(chart.switch, "switch", ["label", "default"]);
    text(chart.switch.label, "switch.label", { max: 12 });
    if (views.length < 2)
      err("views", `switch があれば2つ以上 / 実際: ${views.length}個`);
    if (!views.some((v) => v?.key === chart.switch.default))
      err(
        "switch.default",
        `views の key のどれか / 実際: ${show(chart.switch.default)}`,
      );
  }

  // 出典
  const src = chart.source;
  if (!isObj(src)) err("source", `{ name, dataVersion } / 実際: ${show(src)}`);
  else {
    keysOnly(src, "source", ["name", "dataVersion", "resultPath"]);
    text(src.name, "source.name", { max: 60 });
    date(src.dataVersion, "source.dataVersion");
    if (src.resultPath !== undefined && typeof src.resultPath !== "string")
      err("source.resultPath", `文字列 / 実際: ${show(src.resultPath)}`);
  }

  // 中身
  if (!Array.isArray(chart.views) || views.length === 0)
    err("views", "1つ以上の view が要る");
  const viewKeys = new Set();
  views.forEach((v, vi) => {
    const p = `views[${vi}]`;
    if (!isObj(v))
      return err(p, `{ key, label, badge, series } / 実際: ${show(v)}`);
    keysOnly(v, p, ["key", "label", "description", "badge", "series"]);
    key(v.key, `${p}.key`);
    if (viewKeys.has(v.key)) err(`${p}.key`, `key の重複: ${show(v.key)}`);
    viewKeys.add(v.key);
    text(v.label, `${p}.label`, { max: 12 });
    text(v.description, `${p}.description`, { max: 120, required: false });

    const b = v.badge;
    let sample = null;
    if (!isObj(b)) err(`${p}.badge`, "{ scope, period, sample } が要る");
    else {
      keysOnly(b, `${p}.badge`, ["scope", "period", "sample"]);
      text(b.scope, `${p}.badge.scope`, { max: 20 });
      if (!isObj(b.period)) err(`${p}.badge.period`, "{ from, to } が要る");
      else {
        keysOnly(b.period, `${p}.badge.period`, ["from", "to"]);
        date(b.period.from, `${p}.badge.period.from`);
        date(b.period.to, `${p}.badge.period.to`);
        if (b.period.from > b.period.to)
          err(
            `${p}.badge.period`,
            `from ≦ to / 実際: ${b.period.from}〜${b.period.to}`,
          );
        if (
          isObj(src) &&
          typeof src.dataVersion === "string" &&
          b.period.to > src.dataVersion
        ) {
          err(
            `${p}.badge.period.to`,
            `source.dataVersion（${src.dataVersion}）以前 / 実際: ${b.period.to}`,
          );
        }
      }
      if (!isObj(b.sample)) err(`${p}.badge.sample`, "{ value, unit } が要る");
      else {
        keysOnly(b.sample, `${p}.badge.sample`, ["value", "unit"]);
        if (!Number.isInteger(b.sample.value) || b.sample.value <= 0)
          err(
            `${p}.badge.sample.value`,
            `正の整数 / 実際: ${show(b.sample.value)}`,
          );
        else sample = b.sample.value;
        text(b.sample.unit, `${p}.badge.sample.unit`, { max: 8 });
      }
    }

    const series = Array.isArray(v.series) ? v.series : [];
    if (series.length < kind.series[0] || series.length > kind.series[1]) {
      err(
        `${p}.series`,
        `${kind.series[0]}〜${kind.series[1]}個 / 実際: ${Array.isArray(v.series) ? series.length : show(v.series)}`,
      );
    }
    series.forEach((s, si) => {
      const sp = `${p}.series[${si}]`;
      if (!isObj(s))
        return err(sp, `{ key, label, values } / 実際: ${show(s)}`);
      keysOnly(s, sp, ["key", "label", "values", "counts", "totals"]);
      key(s.key, `${sp}.key`);
      text(s.label, `${sp}.label`, { max: 12 });
      const values = Array.isArray(s.values) ? s.values : [];
      if (!Array.isArray(s.values) || values.length !== rows.length) {
        err(
          `${sp}.values`,
          `rows と同じ ${rows.length}個 / 実際: ${Array.isArray(s.values) ? values.length : show(s.values)}`,
        );
      }
      const scale = 10 ** decimals;
      values.forEach((x, i) => {
        if (typeof x !== "number" || !Number.isFinite(x))
          return err(`${sp}.values[${i}]`, `数 / 実際: ${show(x)}`);
        if (Math.abs(Math.round(x * scale) - x * scale) > 1e-6)
          err(`${sp}.values[${i}]`, `小数 ${decimals}桁まで / 実際: ${x}`);
        if (unit === "%" && (x < 0 || x > 100))
          err(`${sp}.values[${i}]`, `0〜100 / 実際: ${x}`);
        if (x < 0)
          err(`${sp}.values[${i}]`, `0 以上（値の軸は0から） / 実際: ${x}`);
      });
      const intArray = (arr, name) => {
        if (arr === undefined) return null;
        if (!Array.isArray(arr) || arr.length !== rows.length) {
          err(
            `${sp}.${name}`,
            `rows と同じ ${rows.length}個の整数 / 実際: ${show(arr)}`,
          );
          return null;
        }
        const bad = arr.findIndex((n) => !Number.isInteger(n) || n < 0);
        if (bad >= 0) {
          err(
            `${sp}.${name}[${bad}]`,
            `0 以上の整数 / 実際: ${show(arr[bad])}`,
          );
          return null;
        }
        return arr;
      };
      if (unit === "%" && s.counts === undefined)
        err(`${sp}.counts`, "単位が % のときは counts（分子の件数）が要る");
      const counts = intArray(s.counts, "counts");
      const totals = intArray(s.totals, "totals");
      if (counts && unit === "%") {
        counts.forEach((c, i) => {
          const denom = totals ? totals[i] : sample;
          if (!denom) return;
          if (c > denom)
            return err(`${sp}.counts[${i}]`, `分母 ${denom} 以下 / 実際: ${c}`);
          const expected = Math.round((c * 100 * scale) / denom);
          if (
            typeof values[i] === "number" &&
            expected !== Math.round(values[i] * scale)
          ) {
            err(
              `${sp}.values[${i}]`,
              `counts ${c}/${denom} から ${(expected / scale).toFixed(decimals)} / 実際: ${values[i]}`,
            );
          }
        });
      }
    });
  });

  // 答えの数字は、その view か全国（all）の値だけ
  const numbersIn = (t) =>
    [...localize(t, "ja").matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) =>
      Number(m[1]),
    );
  const allowedNumbers = (view) =>
    new Set(
      [view, views.find((v) => v?.key === "all")]
        .filter(isObj)
        .flatMap((v) =>
          (Array.isArray(v.series) ? v.series : []).flatMap((s) =>
            Array.isArray(s?.values) ? s.values : [],
          ),
        ),
    );
  // 最上位の答えは、図の中の値（会場どうしの比べを含む）だけ。数字の写し間違いを拾う
  const everyNumber = new Set(
    views.filter(isObj).flatMap((v) => [...allowedNumbers(v)]),
  );
  for (const n of numbersIn(chart.description)) {
    if (!everyNumber.has(n))
      err("description", `数字は views のどれかの値だけ / 実際: ${n}%`);
  }
  views.forEach((v, vi) => {
    if (!isObj(v) || v.description === undefined) return;
    const ok = allowedNumbers(v);
    for (const n of numbersIn(v.description)) {
      if (!ok.has(n))
        err(
          `views[${vi}].description`,
          `数字はこの view（${v.key}）か all の値だけ / 実際: ${n}%`,
        );
    }
  });

  return errors;
}
