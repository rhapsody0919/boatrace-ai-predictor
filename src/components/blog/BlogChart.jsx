/**
 * BlogChart - ブログ記事に埋め込む図（記事の <ryujin-chart src rows> から描く）
 *
 * 契約: docs/design/blog-charts/contract.md（検査は src/utils/blogChartContract.js）。
 * 承認したモック: docs/design/blog-charts/mock/APPROVED.md。
 *
 * ファン役の条件は JSON から変えられないよう、ここで強制する。
 * - 開いた時点で答えが出ている: 既定の view を最初の描画で出す。遅延描画しない
 * - 値を常に出す: 値は HTML の文字（ホバーに頼らない。AI 向けのスナップショットにも文字で載る）
 * - 切り替えは1つまで: 契約の形で1つ。6つまでボタン、7つ以上は選ぶ箱
 * - CLS を防ぐ: タグの rows から読み込み前の高さを CSS で確保し、アニメーションしない
 * 読み込みの状態は data-chart-state（loading・ready・error）で外に示す。
 * scripts/generate-ai-snapshots.js は loading が無くなるまで待ち、error の記事は失敗として数える。
 */
import { useEffect, useId, useState } from "react";
import InlineFetchError from "../InlineFetchError";
import {
  localize,
  validateBlogChart,
  valueAxisMax,
} from "../../utils/blogChartContract";
import "./BlogChart.css";

/** 部品が持つ言葉。図の中身の文字は JSON（契約 5 節） */
const UI_TEXT = {
  ja: {
    loading: "図を読み込んでいます",
    error: "図のデータを読み込めませんでした。ページを読み込み直してください。",
    sample: (n, unit) => `全${n}${unit}`,
    source: (name, date) => `出典: ${name}（集計日 ${date}）`,
    count: (n) => `（${n}回）`,
  },
  en: {
    loading: "Loading the chart",
    error: "Could not load the chart data. Please reload the page.",
    sample: (n, unit) => `${n} ${unit} in total`,
    source: (name, date) => `Source: ${name} (compiled ${date} JST)`,
    count: (n) => ` (n=${n})`,
  },
  "zh-TW": {
    loading: "正在載入圖表",
    error: "無法載入圖表資料。請重新整理頁面。",
    sample: (n, unit) => `共${n}${unit}`,
    source: (name, date) => `資料來源：${name}（統計日 ${date}）`,
    count: (n) => `（${n}次）`,
  },
  ko: {
    loading: "차트를 불러오는 중",
    error: "차트 데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.",
    sample: (n, unit) => `총 ${n}${unit}`,
    source: (name, date) => `출처: ${name}(집계일 ${date})`,
    count: (n) => ` (${n}회)`,
  },
};

/** 件数がこれより少ない行は、値の横に回数を添える（承認したモック、言葉の審査） */
const FEW_COUNT = 30;
/** 選択肢がこの数まで、かつ名前の字数の合計がこれまでならボタン、超えたら選ぶ箱（ボタンは1段。多いと横のスクロールが長くなる） */
const MAX_BUTTONS = 6;
const MAX_BUTTON_CHARS = 18;

const formatDate = (iso) => iso.replaceAll("-", "/");

function HBarRows({ chart, view, lang, ui }) {
  const max = valueAxisMax(chart);
  const { decimals } = chart.axes.value;
  const unit = chart.axes.value.unit;
  const series = view.series[0];
  // 回数を添える行の棒が長い（目盛りの半分を超える）ときだけ、値の右の余白を広げる。
  // 短い棒なら「（19回）」は余白の手前に収まるので、ふだんは棒を短くしない
  const hasLongFew = (series.counts ?? []).some(
    (c, i) => c < FEW_COUNT && series.values[i] / max > 0.5,
  );
  return (
    <ol
      className={`blog-chart__rows${hasLongFew ? " blog-chart__rows--with-count" : ""}`}
    >
      {chart.rows.map((row, i) => {
        const value = series.values[i];
        const count = series.counts?.[i];
        const width = `${(value / max) * 100}%`;
        return (
          <li className="blog-chart__row" key={row.key}>
            <span className="blog-chart__label">
              {row.boat && (
                <span
                  className="blog-chart__boat"
                  data-boat={row.boat}
                  aria-hidden="true"
                >
                  {row.boat}
                </span>
              )}
              {localize(row.label, lang)}
            </span>
            <span className="blog-chart__track">
              <span className="blog-chart__fill" style={{ width }} />
              <span className="blog-chart__value" style={{ left: width }}>
                {value.toLocaleString("ja-JP", {
                  minimumFractionDigits: decimals,
                  maximumFractionDigits: decimals,
                })}
                {unit}
                {count !== undefined && count < FEW_COUNT && (
                  <small>{ui.count(count)}</small>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const BODIES = { hbar: HBarRows };

function BlogChart({ src, rows, lang = "ja" }) {
  const ui = UI_TEXT[lang] ?? UI_TEXT.ja;
  // 取得結果は src とセットで持つ（src だけ変わったときに前の図が混ざらない）
  const [loaded, setLoaded] = useState(null);
  const [selected, setSelected] = useState(null);

  const baseId = useId();

  useEffect(() => {
    let cancelled = false;
    // 許可リスト（blogMarkdownSanitize.js）が /blog-charts/ 以外の src を落とすと undefined で来る
    if (!src) {
      console.error(
        new Error("図の src が無い（/blog-charts/{名前}.json だけ使える）"),
      );
      setLoaded({ src, error: true });
      return undefined;
    }
    fetch(src)
      .then((res) => {
        if (!res.ok)
          throw new Error(`図のデータの取得に失敗（${res.status}）: ${src}`);
        return res.json();
      })
      .then((chart) => {
        const errors = validateBlogChart(chart);
        if (errors.length > 0) {
          throw new Error(
            `図のデータが契約に合わない: ${src}\n${errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`,
          );
        }
        if (!cancelled) setLoaded({ src, chart });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setLoaded({ src, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const current = loaded?.src === src ? loaded : null;
  const state =
    current === null ? "loading" : current.error ? "error" : "ready";
  const style = {
    "--blog-chart-rows": Math.min(Math.max(Number(rows) || 6, 1), 12),
  };

  if (state !== "ready") {
    return (
      <figure
        className="blog-chart"
        data-chart-state={state}
        aria-busy={state === "loading"}
        style={style}
      >
        <div className="blog-chart__placeholder">
          {state === "loading" ? (
            ui.loading
          ) : (
            <InlineFetchError message={ui.error} />
          )}
        </div>
      </figure>
    );
  }

  const { chart } = current;
  const defaultKey = chart.switch ? chart.switch.default : chart.views[0].key;
  // 選んだ key が今の図に無い（src が替わった等）ときは既定の view に戻す
  const view =
    chart.views.find((v) => v.key === selected) ??
    chart.views.find((v) => v.key === defaultKey);
  const Body = BODIES[chart.kind];
  const title = localize(chart.title, lang);
  const answer = localize(view.description ?? chart.description, lang);
  const { badge } = view;
  // 同じ図を1記事に2回置いても id が重ならないよう useId を使う
  const useButtons =
    chart.views.length <= MAX_BUTTONS &&
    chart.views.reduce((n, v) => n + [...localize(v.label, lang)].length, 0) <=
      MAX_BUTTON_CHARS;
  const controlId = `blog-chart-${baseId.replaceAll(":", "")}`;

  return (
    <figure
      className="blog-chart"
      data-chart-state="ready"
      style={style}
      aria-labelledby={`${controlId}-title`}
    >
      {/* 見出し（h3）にしない。記事の目次（BlogPost.jsx が h2・h3 を集める）に図の名前を入れないため */}
      <p className="blog-chart__title" id={`${controlId}-title`}>
        {title}
      </p>
      <p className="blog-chart__answer" aria-live="polite">
        {answer}
      </p>
      {chart.switch && (
        <div className="blog-chart__control">
          {useButtons ? (
            <span
              className="blog-chart__buttons"
              role="group"
              aria-label={localize(chart.switch.label, lang)}
            >
              {chart.views.map((v) => (
                <button
                  type="button"
                  key={v.key}
                  aria-pressed={v.key === view.key}
                  onClick={() => setSelected(v.key)}
                >
                  {localize(v.label, lang)}
                </button>
              ))}
            </span>
          ) : (
            <>
              <label htmlFor={controlId}>
                {localize(chart.switch.label, lang)}
              </label>
              <select
                id={controlId}
                value={view.key}
                onChange={(e) => setSelected(e.target.value)}
              >
                {chart.views.map((v) => (
                  <option value={v.key} key={v.key}>
                    {localize(v.label, lang)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
      <div className="blog-chart__badges" aria-live="polite" aria-atomic="true">
        <span>{localize(badge.scope, lang)}</span>
        <span>
          {formatDate(badge.period.from)}〜{formatDate(badge.period.to)}
        </span>
        <span>
          {ui.sample(
            badge.sample.value.toLocaleString("ja-JP"),
            localize(badge.sample.unit, lang),
          )}
        </span>
      </div>
      <Body chart={chart} view={view} lang={lang} ui={ui} />
      <figcaption className="blog-chart__caption">
        {chart.note && <p>{localize(chart.note, lang)}</p>}
        <p>
          {ui.source(
            localize(chart.source.name, lang),
            formatDate(chart.source.dataVersion),
          )}
        </p>
      </figcaption>
    </figure>
  );
}

export default BlogChart;
