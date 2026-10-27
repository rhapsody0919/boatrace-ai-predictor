/**
 * /today の X 投稿の型 b の画像（1080×1350）を撮るための撮影用のページ（/share/today-sheet）。人が見るページではない（noindex、ja 専用）。
 * 正本: hq drafts/x-today-type-20261027.md §8〜§11、試作 sheet-v4-20261026.png。
 *
 * - 値はサーバー（朝の一覧 morning_digest_days.notes.courseWin）から読み、URL では数字を受けない。URL が渡すのは
 *   日付・送る時刻（from、これより後の締切だけ載せる）・除く行（skip、欠場・中止の "race_id:艇番"）だけ
 * - 中身は計画（scripts/lib/snsTodayPlanner.js）と同じ buildCourseWinSheet で作る。出来上がりの指紋を
 *   data-today-sheet-key に出し、計画はその指紋が自分の物と同じときだけ撮る（本文と画像が同じ行・同じ窓から作られた印）
 * - 段: 1号艇（1コース）最大3行・4号艇（4コース、A1・A2）最大2行。0行の段は出さない。1コースが0行の日は型 b を出さない
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { dataService } from "../services/dataService";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { buildCourseWinSheet } from "../utils/todayCourseWin";
import "./TodaySheet.css";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const SKIP = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}:[1-6]$/;
const SECTION_TITLE = {
  c1: "1号艇（1コースに入ったとき）",
  c4: "4号艇（4コースに入ったとき・A1/A2）",
};
const AXIS_MAX = { c1: 100, c4: 60 };
/**
 * 行が少ない日は行の字・棒を大きくし（名前が横にはみ出さない 1.3 まで）、残りの空きは行の間に配る（段は行の数に応じて伸び、
 * 行は段の中で等間隔）。visual-designer P1-1。値は Noto Sans JP で5行の下余白 64px 以上・最長の名前がはみ出さない目安、根拠なし。
 * 1行の日は型 b を出さない（buildCourseWinSheet が one_row で止める）
 */
const ROW_SCALE = { 2: 1.3, 3: 1.3, 4: 1.15, 5: 0.95 };

/** 期間は終了年を省略しない（number-wording.md） */
const ymd = (d) => d.replaceAll("-", "/");

function formatJaDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}/${d}（${weekday}）`;
}

export default function TodaySheet() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  useRobotsMeta(true);
  const date = params.get("date") ?? "";
  const from = params.get("from") ?? "";
  const skip = (params.get("skip") ?? "").split(",").filter(Boolean);
  const valid =
    DATE.test(date) && TIME.test(from) && skip.every((s) => SKIP.test(s));
  const [state, setState] = useState({
    date: null,
    digest: null,
    failed: false,
  });

  useEffect(() => {
    if (!valid) return undefined;
    let alive = true;
    dataService
      .getMorningDigest(date)
      .then((digest) => alive && setState({ date, digest, failed: false }))
      .catch(() => alive && setState({ date, digest: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [date, valid]);

  if (!valid)
    return (
      <p className="today-sheet-error" data-today-sheet-error="params">
        date・from・skip の形が違う
      </p>
    );
  if (state.failed && state.date === date)
    return (
      <p className="today-sheet-error" data-today-sheet-error="fetch">
        朝の一覧を読めなかった
      </p>
    );
  if (state.date !== date || !state.digest) return null;
  const day = state.digest.day;
  if (state.digest.state !== "generated" || !day)
    return (
      <p className="today-sheet-error" data-today-sheet-error="not_generated">
        朝の一覧がまだ無い
      </p>
    );
  const sheet = buildCourseWinSheet(day.notes?.courseWin, {
    sendAt: from,
    excluded: new Set(skip),
  });
  if (!sheet.ok)
    return (
      <p className="today-sheet-error" data-today-sheet-error={sheet.reason}>
        型 b を作れない日（{sheet.reason}）
      </p>
    );
  const minRuns = sheet.sections.some((s) => s.key === "c4")
    ? `30回以上（4コースは A1 ${sheet.minRunsC4.A1}・A2 ${sheet.minRunsC4.A2}回以上）`
    : "30回以上";

  const rowCount = sheet.sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div
      className="today-sheet"
      data-today-sheet=""
      data-today-sheet-key={sheet.key}
      style={{ "--today-sheet-scale": ROW_SCALE[rowCount] ?? 1 }}
    >
      <div className="today-sheet__kicker">
        {`【今日の注目データ】${formatJaDate(date)}${day.venue_count}場${day.race_count}レース`}
      </div>
      <h1 className="today-sheet__title">今日走る選手のコース別1着率</h1>
      <div className="today-sheet__legend">
        <b aria-hidden="true" />
        ＝級の全国平均。並びは上回る幅の順（回数が少ない人は平均に寄せた）
      </div>
      {sheet.sections.map((section) => (
        <section
          className="today-sheet__section"
          key={section.key}
          style={{ flexGrow: section.rows.length }}
        >
          <div className="today-sheet__section-head">
            <span>{SECTION_TITLE[section.key]}</span>
            <span className="today-sheet__axis">
              軸 0〜{AXIS_MAX[section.key]}%
            </span>
          </div>
          {section.rows.map((row) => (
            <div
              className="today-sheet__row"
              key={`${row.race_id}:${row.boat_number}`}
            >
              <div className="today-sheet__row-top">
                <div className="today-sheet__row-left">
                  <span className="today-sheet__rank">{row.rank}</span>
                  <span className="today-sheet__time">
                    {row.start_time}締切
                  </span>
                  <span
                    className={`today-sheet__badge today-sheet__badge--${row.boat_number}`}
                  >
                    {row.boat_number}
                  </span>
                  <span className="today-sheet__name" translate="no">
                    {row.racer_name}
                  </span>
                  <span className="today-sheet__grade">{row.grade}</span>
                </div>
                <div className="today-sheet__value">{row.pct}%</div>
              </div>
              <div className="today-sheet__track">
                <div
                  className="today-sheet__fill"
                  style={{
                    width: `${Math.min(100, (row.pct / AXIS_MAX[section.key]) * 100)}%`,
                  }}
                />
                <div
                  className="today-sheet__tick"
                  style={{
                    left: `${Math.min(100, (row.baseline_pct / AXIS_MAX[section.key]) * 100)}%`,
                  }}
                />
              </div>
              <div className="today-sheet__sub">
                {t(`venues.${row.venue_code}`)}
                {`${row.race_number}R・${row.runs}回中${row.wins}回・${row.grade}平均 ${row.baseline_pct}%`}
              </div>
            </div>
          ))}
        </section>
      ))}
      {/* 注は文の区切りで2行に分ける（自動の折り返しだと熟語の中で切れる。visual-designer P2-2） */}
      <div className="today-sheet__foot">
        <span className="today-sheet__nowrap">
          {`全国・${ymd(sheet.window.start)}〜${ymd(sheet.window.end)}。`}
        </span>
        <span className="today-sheet__nowrap">{`${minRuns}。`}</span>
      </div>
      <div className="today-sheet__foot">
        展示前で進入は変わり得ます。結果を保証しません
      </div>
      <div className="today-sheet__brand">
        <span className="today-sheet__brand-name">
          <img src="/logo-light.png" alt="" aria-hidden="true" />
          龍神レーダー
        </span>
        <span>全レースの一覧 boat-ai.jp/today</span>
      </div>
    </div>
  );
}
