import { useMemo } from "react";
import {
  buildPeriodRows,
  buildCourseRows,
  COURSE_SUM_PERIODS,
} from "../../pure/racerOfficialPeriodStats.js";
import { buildChartData, chartRates } from "./RacerOfficialStatsLogic";
import { courseRowDir } from "../../pure/sixBoatCourseStats.js";
import { toneOf } from "../../pure/compareBaseline.js";
import InlineFetchError from "../InlineFetchError";
import "./RacerOfficialStats.css";

/**
 * 選手ページの公式の成績（期別成績の推移・進入コース別成績）（GS00、2026-10-28）。
 *
 * 出してよい範囲は data-scientist の確認（docs/design/racer-period-stats/analysis/display-scope.md）:
 * 推移に「調子」や上下の矢印を付けない、「通算」「年別」と言わない、進入10未満の率は出さない・
 * 10〜29は「参考」、どのセルにも進入数を出す、級の中で順位を付けない。
 * 見せ方はファン4人の議論（docs/design/racer-period-stats/fan-panel.md）。
 */

const DEFAULT_VISIBLE_PERIODS = 4;

// 率は小数1桁で切り捨てる。公式の2連対率（fan）は切り捨てで、同じ行の中で丸め方をそろえる（data-accuracy-verifier）
const pct = (v) =>
  v === null ? "-" : `${(Math.floor(v * 10 + 1e-9) / 10).toFixed(1)}%`;
const st = (v) => (v === null ? "-" : v.toFixed(2));

// 狭い幅では表が横に長い。送れることが分からず、端で切れた数字（116 が「11」）を読み違えた（ファン評価 #2051 2周目）
function ScrollHint() {
  return (
    <p className="racer-official-scroll-hint" aria-hidden="true">
      ← 表は横にスクロールできます →
    </p>
  );
}

function PeriodTable({ rows }) {
  return (
    <>
    <ScrollHint />
    <div className="racer-official-table-wrap">
      <table className="racer-official-table">
        <thead>
          <tr>
            <th scope="col">期（集計期間）</th>
            <th scope="col">勝率</th>
            <th scope="col">2連対率</th>
            <th scope="col">3連対率</th>
            <th scope="col">出走</th>
            <th scope="col">1着</th>
            <th scope="col">優出</th>
            <th scope="col">優勝</th>
            <th scope="col">平均ST</th>
            <th scope="col">この期で決まった級</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.label}
                <span className="racer-official-sub">{r.range}</span>
              </th>
              {r.starts === 0 ? (
                <td colSpan={8} className="racer-official-empty">
                  出走なし
                </td>
              ) : (
                <>
                  <td>{r.winRate === null ? "-" : r.winRate.toFixed(2)}</td>
                  <td>{pct(r.top2Rate)}</td>
                  <td>{pct(r.top3Rate)}</td>
                  <td>{r.starts}</td>
                  <td>{r.firsts}</td>
                  <td>{r.finals}</td>
                  <td>{r.wins}</td>
                  <td>{st(r.avgSt)}</td>
                </>
              )}
              <td>
                {r.grade ?? "-"}
                {r.grade && (
                  <span className="racer-official-sub">適用 {r.applied}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function CourseRateCell({ value, reliability }) {
  if (reliability === "none")
    return <td className="racer-official-empty">-</td>;
  return (
    <td>
      {pct(value)}
      {reliability === "reference" && (
        <span className="racer-official-sub">参考</span>
      )}
    </td>
  );
}

// 全選手の同じコース（直近3期）と比べる（意味づけ 2026-11-26）。判定は出走表・枠別情報の6艇の表と同じ（courseRowDir）。
// ▲緑・▼赤は偶然のぶれを超えたときだけ。「参考」（10〜29走）と基準の無いコースは色なし
function compareOf(c, national) {
  const avg = national?.[c.course]?.winRate ?? null;
  if (c.reliability === "none" || c.winRate === null || avg === null) return null;
  const dir = courseRowDir({
    reliability: c.reliability === "firm" ? "ok" : "warn",
    winRate: c.winRate, avg, entries: c.entries, course: c.course,
  });
  return { avg, dir, tone: toneOf(dir, "high"), diff: c.winRate - avg };
}

const MARK_TEXT = { good: "▲全選手より高い", bad: "▼全選手より低い" };

// 1着率の棒（0〜100%）に全選手の位置の縦線（型1・値の尺度。オーナー 2026-11-27 が「+28.6pt」の文字より選んだ）。値と全選手の値を並べる
function CourseWinBars({ summary, national }) {
  return (
    <ul className="racer-official-winbars" aria-label="進入コース別の1着率と全選手">
      {summary.courses.map((c) => {
        const cmp = compareOf(c, national);
        return (
          <li key={c.course} className="racer-official-bar-row" data-tone={cmp?.tone ?? "plain"}>
            <span className="racer-official-bar-label">{c.course}コース</span>
            <span className="racer-official-bar-track racer-official-winbar-track">
              {c.winRate !== null && (
                <span
                  className={`racer-official-bar-fill racer-official-winbar-fill${cmp?.tone ? ` racer-official-winbar-fill--${cmp.tone}` : ""}`}
                  style={{ width: `${c.winRate}%` }}
                />
              )}
              {cmp && (
                <span className="racer-official-winbar-base" style={{ left: `${cmp.avg}%` }} />
              )}
            </span>
            <span className="racer-official-bar-value">
              {c.winRate === null
                ? c.entries === 0 ? "進入なし" : `進入${c.entries}走`
                : `1着率 ${pct(c.winRate)}${c.reliability === "reference" ? "（参考）" : ""}`}
              {cmp && `・全選手 ${cmp.avg.toFixed(1)}%`}
              {cmp?.tone && (
                <>
                  {" "}
                  <span className={`racer-official-winbar-mark ind-${cmp.tone}`}>{MARK_TEXT[cmp.tone]}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// 進入コース別の表（コース・進入・1着率・2連対率・3連対率・平均ST）
function CourseTable({ summary }) {
  return (
    <div className="racer-official-table-wrap">
      <table className="racer-official-table">
        <thead>
          <tr>
            <th scope="col">コース</th>
            <th scope="col">進入</th>
            <th scope="col">1着率</th>
            <th scope="col">2連対率</th>
            <th scope="col">3連対率</th>
            <th scope="col">平均ST</th>
          </tr>
        </thead>
        <tbody>
          {summary.courses.map((c) => (
            <tr key={c.course}>
              <th scope="row">{c.course}</th>
              <td>{c.entries === 0 ? "進入なし" : c.entries}</td>
              <CourseRateCell value={c.winRate} reliability={c.reliability} />
              <CourseRateCell
                value={c.top2Rate}
                reliability={c.reliability}
              />
              <CourseRateCell
                value={c.top3Rate}
                reliability={c.reliability}
              />
              <td>{c.reliability === "none" ? "-" : st(c.avgSt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CourseSection({ summary, courseBaseline }) {
  const national = courseBaseline?.status === "ready" ? courseBaseline.national : null;
  const first = summary.periods.at(-1);
  const last = summary.periods[0];
  const rangeText = `${first.range.split("〜")[0]}〜${last.range.split("〜")[1]}`;
  return (
    <div className="racer-official-block racer-official-block--bars">
      <h3>
        進入コース別成績（公式・{rangeText}の{summary.periods.length}期
        {summary.contiguous ? "" : "、出走のない期を除く"}）
      </h3>
      <p className="racer-official-note">
        実際に何コースに入ったかで分けた公式の成績です（何号艇で出たかで分けた成績は、下の「枠番別成績」）。
        進入が10走未満のコースは率を出さず、10〜29走は「参考」と付けています。
      </p>
      {summary.courses.some((c) => c.entries > 0 && c.entries < 10) && (
        <p className="racer-official-note">
          進入が少ないコースは、その選手が主に入るコースが別にあるためです。
        </p>
      )}
      <p className="racer-official-note">
        公式サイトの選手のコース別成績のページとは集計の期間が違うため、値が合わないことがあります（このページは上の期間の期別成績を足したものです）。
      </p>
      <ul className="racer-official-bars" aria-label="進入コース別の2連対率">
        {summary.courses.map((c) => (
          <li key={c.course} className="racer-official-bar-row">
            <span className="racer-official-bar-label">{c.course}コース</span>
            <span className="racer-official-bar-track">
              {c.top2Rate !== null && (
                <span
                  className="racer-official-bar-fill"
                  style={{ width: `${c.top2Rate}%` }}
                />
              )}
            </span>
            <span className="racer-official-bar-value">
              {c.entries === 0
                ? "進入なし"
                : c.top2Rate === null
                  ? `進入${c.entries}走`
                  : `2連対率 ${pct(c.top2Rate)}${c.reliability === "reference" ? "（参考）" : ""}・進入${c.entries}走`}
            </span>
          </li>
        ))}
      </ul>
      <CourseTable summary={summary} />
      {/* 1着率の段は表の後ろ。PC は「2連対率の棒｜表」を左右に並べ行をそろえるので、その間に入れない */}
      {national && (
        <>
          <h4 className="racer-official-winbars-title">
            1着率（
            <span className="racer-official-winbar-sample" aria-hidden="true" />
            は全選手の同じコース・直近3期）
          </h4>
          <CourseWinBars summary={summary} national={national} />
        </>
      )}
      {courseBaseline?.status === "error" ? (
        <InlineFetchError onRetry={courseBaseline.reload} />
      ) : (
        <p className="racer-official-note">
          全選手の同じコースの1着率（直近3期）と比べています。▲緑・▼赤は、走数から見て偶然のぶれでは説明しにくい差のときだけ付けます。
        </p>
      )}
      <p className="racer-official-note">
        元の期:{" "}
        {summary.periods.map((p) => `${p.label}（${p.range}）`).join("・")}。
        率は{summary.periods.length}
        期の着の回数を足して出しています（率は小数1桁で切り捨て。切り捨ての向きは公式と同じ）。平均STは、期ごとの値を
        F・L・欠場を除いた走の数で重み付けした近似です。
      </p>
    </div>
  );
}

export default function RacerOfficialStats({ rows, racerName, courseBaseline }) {
  const periodRows = useMemo(() => buildPeriodRows(rows), [rows]);
  const courseSummary = useMemo(
    () => buildCourseRows(rows, COURSE_SUM_PERIODS),
    [rows],
  );
  if (periodRows.length === 0) return null;

  const latest = periodRows[0];
  const oldest = periodRows.at(-1);
  // 出走のある期があるか（全期出走なしなら、その旨を書く）
  const rates = chartRates(buildChartData(periodRows));
  const visible = periodRows.slice(0, DEFAULT_VISIBLE_PERIODS);
  const rest = periodRows.slice(DEFAULT_VISIBLE_PERIODS);

  return (
    <section
      className="racer-official-stats"
      aria-labelledby="racer-official-h2"
    >
      <h2 id="racer-official-h2">
        {racerName ? (
          <>
            <span translate="no">{racerName}</span>
            の公式成績（期別・進入コース別）
          </>
        ) : (
          "公式成績（期別・進入コース別）"
        )}
      </h2>
      <p className="racer-official-note">
        ボートレース公式の期別成績です。この表の最新は{latest.label}（集計{" "}
        {latest.range}
        ）です。公式の期別成績は、半年ごとの期が終わってから公開されます。出走表に出る全国勝率とは集計の期間が違います。
      </p>

      <div className="racer-official-block">
        <h3>
          期別成績（公式・{oldest.range.split("〜")[0]}以降の{periodRows.length}
          期）
        </h3>
        {rates.length === 0 && (
          <p className="racer-official-note">
            この{periodRows.length}期に出走はありません。
            {latest.range.split("〜")[1]}
            より後の走は、その期が終わって公式の期別成績が公開されると載ります。
          </p>
        )}
        {/* 期ごとの勝率の段は、成績・調子の欄の「勝率の推移（公式の期ごと）」に1つにまとめた（オーナー 2026-11-27） */}
        <p className="racer-official-note">
          期ごとの勝率の推移の図は、このページの「勝率の推移（公式の期ごと）」にあります。
        </p>
        <PeriodTable rows={visible} />
        {rest.length > 0 && (
          <details className="racer-official-more">
            <summary>それより前の{rest.length}期を見る</summary>
            <PeriodTable rows={rest} />
          </details>
        )}
        <p className="racer-official-note">
          「この期で決まった級」は、その期の成績の審査で決まった級です（「適用」の期間に使われます）。
        </p>
      </div>

      {courseSummary && (
        <CourseSection summary={courseSummary} courseBaseline={courseBaseline} />
      )}
    </section>
  );
}
