import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatPercent } from "../../utils/formatters";
import {
  supabaseDataService,
  aggregateRacerVenueBoatStats,
} from "../../services/supabaseDataService";
import "./RacerPerformanceStats.css";

const TECHNIQUE_COLORS = {
  逃げ: "#0ea5e9",
  差し: "#10b981",
  まくり: "#f59e0b",
  まくり差し: "#ef4444",
  抜き: "#8b5cf6",
  恵まれ: "#94a3b8",
};

function techniqueColor(technique) {
  return TECHNIQUE_COLORS[technique] ?? "#94a3b8";
}

/**
 * 選手個別ページの成績・調子セクション
 * 選手調子（全国勝率推移）・平均ST・決まり手傾向・展示タイム推移・
 * 枠番別回収率をまとめて表示する。/winning-technique の同種タブと
 * 同じ指標を選手個人ページ単体でも見られるようにする。
 * データが一切無い選手（デビュー直後等）ではセクション自体を非表示にする。
 * profile/grade/newsとは別経路で取得するため、読み込み中は簡易表示にする
 *
 * 会場×枠番フィルタ（vcVenue/vcBoat）: 選択時にgetRacerRaceHistoryで選手の
 * 過去2年分の出走履歴を1回だけ取得し（racerId単位でキャッシュ）、以後の
 * 絞り込みはaggregateRacerVenueBoatStats（純粋関数、I/O無し）でメモリ上に
 * 即座に再集計する。フィルタを切り替えるたびにネットワークI/Oが発生しない
 * ようにするための設計。未選択時（全会場×全枠番）は既存のprops
 * （techniqueProfile等）をそのまま表示する。「枠番」表示は、実際の進入
 * コースがBOA-257の制約により取得できない（course_1〜6が常に艇番と一致）
 * ため、発走前に確定する枠番（艇番）基準にしている。同じ制約を持つ
 * 「超展開データ」タブの文言修正はBOA-299として別スコープにしている
 */
export default function RacerPerformanceStats({ racerId, stats, loading }) {
  const { t } = useTranslation();
  // 会場×枠番フィルタ。「全会場」「全枠番」がそれぞれ絞り込みなしを表す。
  // 表示は「枠番」。実際の進入コースはBOA-257の制約により取得できないため、
  // 発走前に決まる枠番（艇番）基準で集計・表示する
  const [vcVenue, setVcVenue] = useState("all");
  const [vcBoat, setVcBoat] = useState("all");
  // 出走履歴取得が失敗した際、手動で再試行するためのトークン。フィルタ
  // （vcVenue/vcBoat）はネットワークI/Oを発生させない設計にしているため、
  // 選び直しでは再試行にならない。専用のトリガーとして分離している
  const [vcRetryToken, setVcRetryToken] = useState(0);
  // racerIdをデータと一緒に保持し、propsのracerIdと食い違えば「別選手の
  // 履歴」として無視する（同一マウントのまま別選手ページへ遷移した場合に、
  // 前選手の履歴が新しい選手のフィルタ結果として残り続けるのを防ぐ）。
  // useEffectでracerId変化時にリセットする代わりにレンダー中の導出値として
  // 扱うことで、エフェクト内での同期的なsetStateを避けている
  const [vcHistoryState, setVcHistoryState] = useState({
    racerId: null,
    fetching: false,
    data: null,
    error: false,
  });
  const vcActive = vcVenue !== "all" || vcBoat !== "all";
  const vcHistory =
    vcHistoryState.racerId === racerId ? vcHistoryState.data : null;
  const vcHistoryLoading =
    vcActive &&
    !!racerId &&
    vcHistory === null &&
    vcHistoryState.racerId === racerId &&
    vcHistoryState.fetching;
  const vcHistoryError =
    vcActive && vcHistoryState.racerId === racerId && vcHistoryState.error;

  useEffect(() => {
    // 未選択（全会場×全枠番）時は既存のprops（techniqueProfile等）を使うため
    // 何もしない。履歴は初回フィルタ操作時に1回だけ取得し、以後の
    // フィルタ変更はvcDataのuseMemoでネットワークI/O無しに再計算する
    if (!vcActive || !racerId || vcHistory !== null) return;
    let cancelled = false;
    const loadHistory = async () => {
      setVcHistoryState({ racerId, fetching: true, data: null, error: false });
      try {
        const result = await supabaseDataService.getRacerRaceHistory(racerId);
        if (!cancelled) {
          setVcHistoryState({
            racerId,
            fetching: false,
            data: result,
            error: false,
          });
        }
      } catch (err) {
        console.error("選手出走履歴取得エラー:", err.message);
        if (!cancelled) {
          setVcHistoryState({
            racerId,
            fetching: false,
            data: null,
            error: true,
          });
        }
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [racerId, vcActive, vcHistory, vcRetryToken]);

  const vcData = useMemo(() => {
    if (!vcActive || !vcHistory) return null;
    return aggregateRacerVenueBoatStats(
      vcHistory,
      vcVenue === "all" ? null : Number(vcVenue),
      vcBoat === "all" ? null : Number(vcBoat),
    );
  }, [vcActive, vcHistory, vcVenue, vcBoat]);

  const vcTechTotal = vcData
    ? Object.values(vcData.tech).reduce((a, b) => a + b, 0)
    : 0;
  const vcVenueLabel =
    vcVenue === "all" ? "全会場" : t(`venues.${vcVenue}`, vcVenue);
  const vcBoatLabel = vcBoat === "all" ? "全枠番" : `${vcBoat}号艇`;
  const vcLabel = `${vcVenueLabel}×${vcBoatLabel}`;
  const {
    formSummary,
    formTrend,
    techniqueProfile,
    aggregatedStats,
    exhibitionTimeTrend,
    boatReturnRate,
    venueStats,
  } = stats ?? {};

  // 決まり手表示用に、フィルタ有無に関わらず同じ形（{technique, count, percentage}[]）
  // へ正規化する。JSXブロックを1つに統一するため（両ブランチの見た目の重複を回避）
  const displayTechniques = vcActive
    ? Object.entries(vcData?.tech ?? {}).map(([technique, count]) => ({
        technique,
        count,
        percentage: vcTechTotal > 0 ? (count / vcTechTotal) * 100 : 0,
        countLabel: `${count}回/${vcTechTotal}回`,
      }))
    : (techniqueProfile?.techniques ?? []).map((tech) => ({
        technique: tech.technique,
        count: tech.count,
        percentage: tech.percentage,
        countLabel: `${tech.count}回`,
      }));

  const chartData = (formTrend?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    national_win_rate: row.win_rate,
    local_win_rate: row.local_win_rate,
  }));

  const exhibitionChartData = (exhibitionTimeTrend?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    avg_exhibition_time: row.avg_exhibition_time,
  }));

  const hasTechniques = (techniqueProfile?.techniques?.length ?? 0) > 0;
  // 決まり手傾向セクションの表示要否: フィルタ選択中は読み込み中または
  // 該当レースがある場合のみ、未選択時は既存のhasTechniques（unfiltered
  // props）で判定する。vcData.n===0の場合を含めてしまうと、上で既に出す
  // 「該当する出走がありません」と重複した空のセクションが表示される
  const showTechniqueSection = vcActive
    ? vcHistoryLoading || (vcData && vcData.n > 0)
    : hasTechniques;
  const hasReturnRate = (boatReturnRate?.length ?? 0) > 0;

  // course_race_counts: { "1": { total, wins, top2, top3 }, ... } → コース番号昇順の配列に変換
  const courseStats = Object.entries(aggregatedStats?.course_race_counts ?? {})
    .map(([course, counts]) => ({
      course: Number(course),
      total: counts.total ?? 0,
      wins: counts.wins ?? 0,
      winRate: counts.total > 0 ? counts.wins / counts.total : null,
      // top2/top3は本チケット（BOA-268）で追加したフィールドのため、
      // バッチ集計（aggregate-racer-stats.js）が再実行されるまでは
      // 未集計の選手が存在する。undefinedを0扱いすると「2連率0%」と
      // 誤表示するため、区別してnull（"-"表示）にする
      top2Rate:
        counts.total > 0 && counts.top2 !== undefined
          ? counts.top2 / counts.total
          : null,
      top3Rate:
        counts.total > 0 && counts.top3 !== undefined
          ? counts.top3 / counts.total
          : null,
    }))
    .filter((row) => row.total >= 5)
    .sort((a, b) => a.course - b.course);
  const hasCourseStats = courseStats.length > 0;

  const hasVenueStats = (venueStats?.length ?? 0) > 0;

  const hasAnyData =
    formSummary != null ||
    chartData.length > 0 ||
    hasTechniques ||
    aggregatedStats != null ||
    exhibitionChartData.length > 0 ||
    hasReturnRate ||
    hasCourseStats ||
    hasVenueStats;

  if (loading) {
    return (
      <div className="racer-performance-stats">
        <h2>成績・調子</h2>
        <p className="racer-stat-loading">読み込み中...</p>
      </div>
    );
  }

  if (!hasAnyData) return null;

  return (
    <div className="racer-performance-stats">
      <h2>成績・調子</h2>

      <div className="racer-stat-cards-grid">
        {formSummary && (
          <div className="racer-stat-card">
            <h3>選手調子（全国勝率）</h3>
            <div className="racer-stat-value-row">
              <span className="racer-stat-value">
                {formSummary.current_win_rate?.toFixed(2)}
              </span>
              {formSummary.delta !== null && (
                <span
                  className={`racer-stat-delta ${
                    formSummary.delta > 0
                      ? "racer-stat-delta-up"
                      : formSummary.delta < 0
                        ? "racer-stat-delta-down"
                        : ""
                  }`}
                >
                  {formSummary.delta > 0
                    ? "↑"
                    : formSummary.delta < 0
                      ? "↓"
                      : "→"}{" "}
                  {Math.abs(formSummary.delta).toFixed(2)}
                </span>
              )}
            </div>
            <p className="racer-stat-note">
              約90日前:{" "}
              {formSummary.past_win_rate !== null
                ? formSummary.past_win_rate.toFixed(2)
                : "データなし"}
            </p>
          </div>
        )}

        {aggregatedStats?.avg_st != null && (
          <div className="racer-stat-card">
            <h3>平均ST</h3>
            <div className="racer-stat-value-row">
              <span className="racer-stat-value">
                {Number(aggregatedStats.avg_st).toFixed(3)}
              </span>
              {aggregatedStats.flying_rate > 0 && (
                <span className="racer-stat-sub">
                  F率 {(aggregatedStats.flying_rate * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <p className="racer-stat-note">
              直近30走平均:{" "}
              {aggregatedStats.avg_st_last_30 != null
                ? Number(aggregatedStats.avg_st_last_30).toFixed(3)
                : "-"}
              （全{aggregatedStats.total_races}走）
            </p>
          </div>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="racer-stat-chart">
          <h3>全国勝率・当地勝率の推移</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => value?.toFixed(2)} />
              <Legend />
              <Line
                type="stepAfter"
                dataKey="national_win_rate"
                name="全国勝率"
                stroke="var(--brand-accent-primary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                type="stepAfter"
                dataKey="local_win_rate"
                name="当地勝率"
                stroke="var(--brand-accent-secondary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasVenueStats && (
        <div className="racer-technique-profile">
          <h3>会場別成績（当地成績、過去2年・出走5走以上）</h3>
          <div className="table-wrapper">
            <table className="racer-return-rate-table" translate="no">
              <thead>
                <tr>
                  <th>会場</th>
                  <th>出走数</th>
                  <th>勝率</th>
                  <th>2連率</th>
                  <th>3連率</th>
                </tr>
              </thead>
              <tbody>
                {venueStats.map((row) => (
                  <tr
                    key={row.venue_code}
                    className={
                      vcVenue !== "all" && String(row.venue_code) === vcVenue
                        ? "racer-vc-row-highlight"
                        : ""
                    }
                  >
                    <td>{t(`venues.${row.venue_code}`)}</td>
                    <td>{row.total_races}</td>
                    <td>
                      {row.win_rate !== null
                        ? formatPercent(row.win_rate)
                        : "-"}
                    </td>
                    <td>
                      {row.top2_rate !== null
                        ? formatPercent(row.top2_rate)
                        : "-"}
                    </td>
                    <td>
                      {row.top3_rate !== null
                        ? formatPercent(row.top3_rate)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasCourseStats && (
        <div className="racer-technique-profile">
          <h3>枠番別成績（全会場計）</h3>
          <p className="racer-vc-note">
            ※実際の進入コース変化（前づけ）は現時点では区別できないため、発走前に決まる枠番（艇番）基準で表示しています
          </p>
          <div className="table-wrapper">
            <table className="racer-return-rate-table">
              <thead>
                <tr>
                  <th>枠番</th>
                  <th>出走数</th>
                  <th>勝数</th>
                  <th>勝率</th>
                  <th>2連率</th>
                  <th>3連率</th>
                </tr>
              </thead>
              <tbody>
                {courseStats.map((row) => (
                  <tr
                    key={row.course}
                    className={
                      vcBoat !== "all" && row.course === Number(vcBoat)
                        ? "racer-vc-row-highlight"
                        : ""
                    }
                  >
                    <td>{row.course}</td>
                    <td>{row.total}</td>
                    <td>{row.wins}</td>
                    <td>
                      {row.winRate !== null ? formatPercent(row.winRate) : "-"}
                    </td>
                    <td>
                      {row.top2Rate !== null
                        ? formatPercent(row.top2Rate)
                        : "-"}
                    </td>
                    <td>
                      {row.top3Rate !== null
                        ? formatPercent(row.top3Rate)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasReturnRate && (
        <div className="racer-technique-profile">
          <h3>枠番別回収率（過去180日）</h3>
          <div className="table-wrapper">
            <table className="racer-return-rate-table">
              <thead>
                <tr>
                  <th>枠番</th>
                  <th>出走数</th>
                  <th>単勝回収率</th>
                  <th>複勝回収率</th>
                </tr>
              </thead>
              <tbody>
                {boatReturnRate.map((row) => (
                  <tr key={row.boat_number}>
                    <td>{row.boat_number}</td>
                    <td>{row.sample_count}</td>
                    <td>
                      {row.win_return_rate !== null
                        ? `${row.win_return_rate.toFixed(0)}%`
                        : "-"}
                    </td>
                    <td>
                      {row.place_return_rate !== null
                        ? `${row.place_return_rate.toFixed(0)}%`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasVenueStats && (
        <div className="racer-vc-filter controls-section">
          <div className="racer-vc-filter-field">
            <label htmlFor="vc-venue">会場</label>
            <select
              id="vc-venue"
              className="venue-select"
              value={vcVenue}
              onChange={(e) => setVcVenue(e.target.value)}
            >
              <option value="all">全会場</option>
              {venueStats.map((row) => (
                <option key={row.venue_code} value={row.venue_code}>
                  {t(`venues.${row.venue_code}`, row.venue_code)}
                </option>
              ))}
            </select>
          </div>
          <div className="racer-vc-filter-field">
            <label htmlFor="vc-boat">枠番</label>
            <select
              id="vc-boat"
              className="venue-select"
              value={vcBoat}
              onChange={(e) => setVcBoat(e.target.value)}
            >
              <option value="all">全枠番</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}号艇
                </option>
              ))}
            </select>
          </div>
          {vcActive && (
            <span className="racer-vc-filter-badge">
              {vcHistoryError
                ? `${vcLabel}（読み込みに失敗しました）`
                : vcHistoryLoading
                  ? `${vcLabel}（集計中…）`
                  : vcData
                    ? `${vcLabel}（${vcData.n}走）`
                    : vcLabel}
            </span>
          )}
        </div>
      )}

      {vcActive && vcHistoryLoading && (
        <p className="racer-stat-note">集計中…</p>
      )}

      {vcActive && vcHistoryError && (
        <p className="racer-stat-note">
          出走履歴の取得に失敗しました。
          <button
            type="button"
            className="racer-vc-retry-button"
            onClick={() => setVcRetryToken((n) => n + 1)}
          >
            再試行
          </button>
        </p>
      )}

      {vcActive && vcData && vcData.n > 0 && (
        <div className="racer-stat-cards-grid">
          <div className="racer-stat-card">
            <h3>勝率</h3>
            <span className="racer-stat-value">
              {vcData.winRate !== null ? formatPercent(vcData.winRate) : "-"}
            </span>
            <p className="racer-stat-note">
              {vcData.win}回/{vcData.n}回
            </p>
          </div>
          <div className="racer-stat-card">
            <h3>2連率</h3>
            <span className="racer-stat-value">
              {vcData.top2Rate !== null ? formatPercent(vcData.top2Rate) : "-"}
            </span>
            <p className="racer-stat-note">
              {vcData.top2}回/{vcData.n}回
            </p>
          </div>
          <div className="racer-stat-card">
            <h3>3連率</h3>
            <span className="racer-stat-value">
              {vcData.top3Rate !== null ? formatPercent(vcData.top3Rate) : "-"}
            </span>
            <p className="racer-stat-note">
              {vcData.top3}回/{vcData.n}回
            </p>
          </div>
          <div className="racer-stat-card">
            <h3>単勝回収率</h3>
            <span className="racer-stat-value">
              {vcData.returnRate !== null
                ? `${vcData.returnRate.toFixed(0)}%`
                : "-"}
            </span>
            <p className="racer-stat-note">{vcData.n}回</p>
          </div>
        </div>
      )}

      {vcActive && !vcHistoryLoading && vcData && vcData.n === 0 && (
        <p className="racer-stat-note">
          {vcLabel}: 該当する出走がありません（対象期間: 過去2年）
        </p>
      )}

      {showTechniqueSection && (
        <div className="racer-technique-profile">
          <h3>
            決まり手傾向（過去90日・勝利時）
            {vcActive && <span className="racer-vc-scope">— {vcLabel}</span>}
          </h3>
          {vcActive && (vcHistoryLoading || !vcData) ? (
            <p className="racer-stat-note">集計中…</p>
          ) : displayTechniques.length > 0 ? (
            <>
              <div className="racer-technique-bar" translate="no">
                {displayTechniques.map((tech) => (
                  <div
                    key={tech.technique}
                    className="racer-technique-bar-segment"
                    style={{
                      width: `${tech.percentage}%`,
                      background: techniqueColor(tech.technique),
                    }}
                    title={`${tech.technique} ${tech.percentage.toFixed(1)}%`}
                  />
                ))}
              </div>
              <ul className="racer-technique-legend" translate="no">
                {displayTechniques.map((tech) => (
                  <li key={tech.technique}>
                    <span
                      className="racer-technique-dot"
                      style={{ background: techniqueColor(tech.technique) }}
                    />
                    {tech.technique} {tech.percentage.toFixed(0)}%（
                    {tech.countLabel}）
                  </li>
                ))}
              </ul>
            </>
          ) : vcActive && vcData.win === 0 ? (
            <p className="racer-stat-note">1着なし（0回/{vcData.n}回）</p>
          ) : vcActive ? (
            <p className="racer-stat-note">
              決まり手データなし（勝利{vcData.win}回中、記録なし）
            </p>
          ) : null}
        </div>
      )}

      {(vcActive
        ? vcData?.series?.length > 0
        : exhibitionChartData.length > 0) && (
        <div className="racer-stat-chart">
          <h3>
            展示タイムの推移
            {vcActive && <span className="racer-vc-scope">— {vcLabel}</span>}
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={vcActive ? vcData.series : exhibitionChartData}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip formatter={(value) => value?.toFixed(2)} />
              <Line
                type="stepAfter"
                dataKey="avg_exhibition_time"
                name="展示タイム"
                stroke="var(--brand-accent-primary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {vcActive && vcData && vcData.stN > 1 && (
        <div className="racer-stat-chart">
          <h3>
            STの推移
            <span className="racer-vc-scope">— {vcLabel}</span>
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={vcData.series}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip formatter={(value) => value?.toFixed(3)} />
              <Line
                type="stepAfter"
                dataKey="start_timing"
                name="ST"
                stroke="var(--brand-accent-secondary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="racer-analysis-tools-link">
        <Link to="/winning-technique?tab=techprofile">
          データ分析ツールで本日開催中の会場・レース単位の傾向も見る →
        </Link>
      </p>
    </div>
  );
}
