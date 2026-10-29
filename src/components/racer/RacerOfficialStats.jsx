import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { winRateAxis } from "../../utils/chartDomain";
import {
  buildPeriodRows,
  buildCourseRows,
  COURSE_SUM_PERIODS,
} from "../../utils/racerOfficialPeriodStats";
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

function CourseSection({ summary }) {
  const first = summary.periods.at(-1);
  const last = summary.periods[0];
  const rangeText = `${first.range.split("〜")[0]}〜${last.range.split("〜")[1]}`;
  return (
    <div className="racer-official-block">
      <h3>
        進入コース別成績（公式・{rangeText}の{summary.periods.length}期
        {summary.contiguous ? "" : "、出走のない期を除く"}）
      </h3>
      <p className="racer-official-note">
        実際に何コースに入ったかで分けた公式の成績です（何号艇で出たかで分けた成績は、下の「枠番別成績」）。
        進入が10走未満のコースは率を出さず、10〜29走は「参考」と付けています。
      </p>
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

export default function RacerOfficialStats({ rows, racerName }) {
  const periodRows = useMemo(() => buildPeriodRows(rows), [rows]);
  const courseSummary = useMemo(
    () => buildCourseRows(rows, COURSE_SUM_PERIODS),
    [rows],
  );
  if (periodRows.length === 0) return null;

  const latest = periodRows[0];
  const oldest = periodRows.at(-1);
  // 折れ線は古い期から順に左→右。出走0の期は点を置かない
  const chartData = [...periodRows]
    .reverse()
    .map((r) => ({ label: r.label, range: r.range, winRate: r.winRate }));
  // 縦軸は値の幅いっぱいに広げず（小さな上下が大きく見え、推移を「調子」と読ませる。data-scientist）、
  // 整数の刻みで等間隔に目盛る（BOA-1196。自動だと 1 / 3 / 5 / 8 になる）
  const rates = chartData.map((d) => d.winRate).filter((v) => v !== null);
  const rateAxis = winRateAxis(rates);
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
        {chartData.length > 1 && rates.length > 0 && (
          <div className="racer-official-chart">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 16, left: -8, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                {/* 最後（最新）の期の目盛りは必ず出す。表の先頭の行と折れ線の右端を対応させるため */}
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={rateAxis?.domain}
                  ticks={rateAxis?.ticks}
                  interval={0}
                />
                {/* 期の名前だけだと今の半期と読み違えるので、集計期間を添える（ファン評価 #2051 1周目）。
                    375px で右端が切れないよう、系列名は短くする */}
                <Tooltip
                  wrapperStyle={{ maxWidth: 200 }}
                  contentStyle={{ whiteSpace: "normal" }}
                  formatter={(value) => value?.toFixed(2)}
                  labelFormatter={(label, payload) =>
                    payload?.[0]?.payload?.range
                      ? `${label}（集計 ${payload[0].payload.range}）`
                      : label
                  }
                />
                {/* 線を左から描く動きは止める（isAnimationActive）。描きかけの途中で見ると最後の点が左に寄って見え、
                    最新の期と位置が合わない（Orchestrate の Preview の確認 10/28）。ボットの描画も最終の形で読む */}
                <Line
                  type="linear"
                  dataKey="winRate"
                  name="勝率"
                  stroke="var(--brand-accent-primary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="racer-official-note">期ごとの勝率（公式）。</p>
          </div>
        )}
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

      {courseSummary && <CourseSection summary={courseSummary} />}
    </section>
  );
}
