/**
 * RaceStConsiderationCard - ST考察（phase a FR-1）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.1.2
 *       モック: https://claude.ai/artifact/N3e6TSHmoPXzLNX1SSSLZK （Version 8）
 *
 * 6艇 × 指標のグリッド。安定率・出遅率には**同じコース・同じ級別の平均との差**を
 * 併記する。生の値だけでは評価が逆転するため（実データの例: 守屋美穂 A1・5コース
 * 出遅率25.9% は平均より+12.1pt「悪い」、吉原快誓 B2・6コース 26.0% は
 * 平均より−10.6pt「良い」。生の値はほぼ同じなのに評価は正反対）。
 *
 * ## 抜出は率ではなく実回数
 *
 * 5・6コースは30走あたりの期待回数が0.2〜0.4回しかなく、率にすると
 * 「0.0%が並ぶ」か「1回の出来事が3.3%に見える」のどちらかになる。
 * 実回数を主表示にし、同コース・同級別の期待回数を添える（率は画面に出さない）。
 * 期待回数が1回未満のセルで0回のときは差の色を付けない（赤くすると誤読される）。
 *
 * ## Fの扱い
 *
 * Fの走は母数に入れない（ST順1位の基準からも外す。符号反転はしない）。
 * 代わりに級別セルの中にFバッジを出す。艇番ヘッダは枠色で塗られており、
 * 金・赤のバッジを重ねるとコントラストが確保できないため。
 * F1は金、F2は赤で色を分ける（F2は合計90日のあっせん停止で意味が違う）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats";
import { computeStConsideration } from "../../utils/stConsideration";
import {
  METRIC_DIRECTION,
  indexBaseline,
  getBaselineCell,
  diffFromBaseline,
  diffTone,
  expectedBreakoutCount,
} from "../../utils/courseBaseline";
import TermHintButton from "./TermHintButton";
import FlyingBadge from "./FlyingBadge";
import RaceStConsiderationCardFolds from "./RaceStConsiderationCardFolds";
import "./RaceStConsiderationCard.css";

/** 差の表示（+12.1 / −10.6）。符号は全角マイナスにせずCSSで色を分ける */
function formatDiff(diff) {
  if (diff === null || diff === undefined) return null;
  const abs = Math.abs(diff).toFixed(1);
  // 表示の桁で0になる差に符号を付けない（「−0.0」と出ていた）
  if (Number(abs) === 0) return abs;
  const sign = diff > 0 ? "+" : "−";
  return `${sign}${abs}`;
}

/** 表示と同じ1桁に丸める。差は丸めた値どうしで出す（BOA-711: 「32.1 −0.7 平均32.9」と
 * 画面の数字の引き算と食い違った）。色の判定（diffTone）も同じ差で行う */
const round1 = (v) =>
  v === null || v === undefined ? null : Number(Number(v).toFixed(1));

/** 率（安定率・出遅率）の差は ±1.0 以内を色なし（抜出の回数は diffTone の既定 ±0.1。BOA-711） */
const RATE_TONE_THRESHOLD = 1;

function diffClass(tone) {
  return tone === "better" ? " is-better" : tone === "worse" ? " is-worse" : "";
}

const isSmallSample = (stats) =>
  (stats?.n ?? 0) > 0 && (stats?.n ?? 0) < SMALL_SAMPLE_THRESHOLD;

/** 艇ごとに「想定コース × 級別」で指標とベースラインとの差を組み立てる */
function buildColumns(sorted, scopedByRacer, baselineIndex, entryCourseOf) {
  return sorted.map((p) => {
    const records = p.racerId ? scopedByRacer[p.racerId] : null;
    const course = entryCourseOf(p);
    // 級別は表示中のレースの出走表の値を使う。選手の記録の最後の1件（＝今日に最も近い走）
    // だと、過去のレースを開いたときに別の期の級別が出て、同じセルの F 数（出走表の値）と
    // 時点が食い違っていた（BOA-589。基本情報タブのデータ出走表とも違っていた）。
    // 平均と比べる基準（ベースライン）も同じ級別で引く
    const grade =
      p.grade ??
      (Array.isArray(records)
        ? (records[records.length - 1]?.grade ?? null)
        : null);
    const stats = Array.isArray(records)
      ? computeStConsideration(records, { course })
      : null;
    const cell = getBaselineCell(baselineIndex, course, grade);
    return { player: p, course, grade, stats, cell };
  });
}

function GridHead({ columns }) {
  return (
    <thead>
      <tr>
        <th className="rsc-label-th" scope="col"></th>
        {columns.map(({ player }) => {
          const color = BOAT_COLORS[player.number] || {};
          return (
            <th
              key={player.number}
              className="rsc-boat-th"
              scope="col"
              style={{ background: color.bg, color: color.text }}
            >
              {player.number}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/** 級別（＋Fバッジ）。どのベースラインと比べているかを読めるようにする */
function GradeRow({ columns, flyingRowByBoat, currentMeetFlyingBoats }) {
  const { t } = useTranslation();
  return (
    <tr>
      <th className="rsc-label-th rsc-label-sub" scope="row">
        {t("stConsideration.gradeRow")}
        {/* Fバッジはこの行にしか出ない。6セルに「?」を並べると
            うるさいので行ラベル側に1つだけ置く */}
        <TermHintButton termKey="flyingCount" />
      </th>
      {columns.map(({ player, grade }) => (
        <td key={player.number} className="rsc-cell rsc-cell-meta">
          <span className="rsc-grade">{grade ?? "—"}</span>
          {/* 出所は race_entries.f_count。以前は stats.flyingCount
              （is_flying を窓×コースで数えた回数）を出しており、
              「今期のF」という説明と数字が食い違っていた（T5-3） */}
          <FlyingBadge
            count={flyingRowByBoat?.get(player.number)?.f_count}
            currentMeet={currentMeetFlyingBoats?.has(player.number)}
            lateCount={flyingRowByBoat?.get(player.number)?.l_count}
          />
        </td>
      ))}
    </tr>
  );
}

/** 走数（母数。Fの走は入っていない） */
function RunsRow({ columns }) {
  const { t } = useTranslation();
  return (
    <tr>
      <th className="rsc-label-th rsc-label-sub" scope="row">
        {t("stConsideration.runsRow")}
      </th>
      {columns.map(({ player, stats }) => (
        <td key={player.number} className="rsc-cell rsc-cell-meta">
          <span
            className={`rsc-runs${
              (stats?.n ?? 0) > 0 && stats.n < SMALL_SAMPLE_THRESHOLD
                ? " is-small-sample"
                : ""
            }`}
          >
            {/* 走数が少ない艇は平均との差に色を付けない（diffTone）。凡例の
                「⚠の艇」が表のどこか分かるよう、走数に⚠を付ける
                （PR #1187 ファン評価3周目。コース別成績の走数と同じ印） */}
            {(stats?.n ?? 0) > 0 && stats.n < SMALL_SAMPLE_THRESHOLD && (
              <span title={t("wakuInfo.smallSampleTitle")}>⚠</span>
            )}
            {stats?.n ?? "—"}
          </span>
        </td>
      ))}
    </tr>
  );
}

function StableCell({ stats, cell }) {
  const { t } = useTranslation();
  const value = stats?.stableRate ?? null;
  const { diff, isBetter } = diffFromBaseline(
    round1(value),
    round1(cell?.stable_rate),
    METRIC_DIRECTION.stableRate,
  );
  const small = isSmallSample(stats);
  return (
    <td className="rsc-cell">
      <span className={`rsc-value${small ? " is-small-sample" : ""}`}>
        {value === null ? "—" : value.toFixed(1)}
      </span>
      {diff !== null && (
        <span
          className={`rsc-diff${diffClass(diffTone({ isBetter, diff, small, threshold: RATE_TONE_THRESHOLD }))}`}
        >
          {formatDiff(diff)}
        </span>
      )}
      {/* 選手側の値が「—」のとき（その条件での走が無い）は平均も
          出さない。「— 平均5.2」だけが並ぶと比較対象の無い数字が
          独り歩きする（レビュー指摘、2026-09-24） */}
      {value !== null &&
        cell?.stable_rate !== null &&
        cell?.stable_rate !== undefined && (
          <span className="rsc-baseline">
            {t("stConsideration.average", {
              value: Number(cell.stable_rate).toFixed(1),
            })}
          </span>
        )}
    </td>
  );
}

/** 安定率（高いほど良い） */
function StableRow({ columns }) {
  const { t } = useTranslation();
  return (
    <tr>
      <th className="rsc-label-th" scope="row">
        <span>{t("stConsideration.stable")}</span>
        <TermHintButton termKey="stStable" />
        <span className="rsc-dir">{t("stConsideration.dirHigher")}</span>
      </th>
      {columns.map(({ player, stats, cell }) => (
        <StableCell key={player.number} stats={stats} cell={cell} />
      ))}
    </tr>
  );
}

function InnerBoatBreakoutCell() {
  const { t } = useTranslation();
  return (
    <td className="rsc-cell">
      <span className="rsc-value rsc-muted">—</span>
      <span className="rsc-note-small">{t("stConsideration.noInnerBoat")}</span>
    </td>
  );
}

/** 抜出の回数・期待回数・差と、差の良し悪し（色の判定の入力） */
function breakoutMetrics(stats, cell) {
  const count = stats?.breakoutCount ?? null;
  const expected = expectedBreakoutCount(
    cell?.breakout_rate ?? null,
    stats?.n ?? 0,
  );
  // 平均（期待回数）との差。多いほど良い。期待回数が1回未満で0回の
  // ときは色を付けない（外のコースは平均0.2〜0.4回で、0回が普通。
  // 赤くすると「抜け出せない選手」と誤読される）
  const breakoutDiff =
    count === null || expected === null ? null : count - round1(expected);
  const breakoutBetter =
    breakoutDiff === null || (count === 0 && expected < 1)
      ? null
      : breakoutDiff > 0;
  return { count, expected, breakoutDiff, breakoutBetter };
}

function BreakoutCell({ course, stats, cell }) {
  const { t } = useTranslation();
  if (course === 1) return <InnerBoatBreakoutCell />;
  const { count, expected, breakoutDiff, breakoutBetter } = breakoutMetrics(
    stats,
    cell,
  );
  const breakoutSmall = isSmallSample(stats);
  return (
    <td className="rsc-cell">
      <span className="rsc-value">
        {count === null ? "—" : t("stConsideration.times", { n: count })}
      </span>
      {breakoutDiff !== null && (
        <span
          className={`rsc-diff${diffClass(diffTone({ isBetter: breakoutBetter, diff: breakoutDiff, small: breakoutSmall }))}`}
        >
          {formatDiff(breakoutDiff)}
        </span>
      )}
      {expected !== null && (
        <span className="rsc-note-small">
          {t("stConsideration.expectedTimes", { n: expected.toFixed(1) })}
        </span>
      )}
    </td>
  );
}

/** 抜出（実回数。率は出さない） */
function BreakoutRow({ columns }) {
  const { t } = useTranslation();
  return (
    <tr>
      <th className="rsc-label-th" scope="row">
        <span>{t("stConsideration.breakout")}</span>
        <TermHintButton termKey="stBreakout" />
        <span className="rsc-dir">{t("stConsideration.dirMore")}</span>
      </th>
      {columns.map(({ player, course, stats, cell }) => (
        <BreakoutCell
          key={player.number}
          course={course}
          stats={stats}
          cell={cell}
        />
      ))}
    </tr>
  );
}

function LateCell({ stats, cell }) {
  const { t } = useTranslation();
  const value = stats?.lateRate ?? null;
  const { diff, isBetter } = diffFromBaseline(
    round1(value),
    round1(cell?.late_rate),
    METRIC_DIRECTION.lateRate,
  );
  const small = isSmallSample(stats);
  return (
    <td className="rsc-cell">
      <span className={`rsc-value${small ? " is-small-sample" : ""}`}>
        {value === null ? "—" : value.toFixed(1)}
      </span>
      {diff !== null && (
        <span
          className={`rsc-diff${diffClass(diffTone({ isBetter, diff, small, threshold: RATE_TONE_THRESHOLD }))}`}
        >
          {formatDiff(diff)}
        </span>
      )}
      {/* 選手側の値が「—」のとき（その条件での走が無い）は平均も
          出さない。「— 平均5.2」だけが並ぶと比較対象の無い数字が
          独り歩きする（レビュー指摘、2026-09-24） */}
      {value !== null &&
        cell?.late_rate !== null &&
        cell?.late_rate !== undefined && (
          <span className="rsc-baseline">
            {t("stConsideration.average", {
              value: Number(cell.late_rate).toFixed(1),
            })}
          </span>
        )}
    </td>
  );
}

/** 出遅率（低いほど良い） */
function LateRow({ columns }) {
  const { t } = useTranslation();
  return (
    <tr>
      <th className="rsc-label-th" scope="row">
        <span>{t("stConsideration.late")}</span>
        <TermHintButton termKey="stLate" />
        <span className="rsc-dir">{t("stConsideration.dirLower")}</span>
      </th>
      {columns.map(({ player, stats, cell }) => (
        <LateCell key={player.number} stats={stats} cell={cell} />
      ))}
    </tr>
  );
}

/** 094未適用（権限なし）・空ならセクションごと出さない（ピットレポートと同じ扱い）ため null */
function usableBaselineRows(baseline) {
  if (baseline && !Array.isArray(baseline) && baseline.state === "forbidden") {
    return null;
  }
  const rows = Array.isArray(baseline) ? baseline : null;
  return !rows || rows.length === 0 ? null : rows;
}

function RaceStConsiderationCard({
  players,
  scopedByRacer,
  baseline,
  entryCourseOf,
  flyingRowByBoat,
  currentMeetFlyingBoats,
}) {
  const { t } = useTranslation();
  // 折りたたみ（ST分布・ST履歴）。どちらも1艇ずつしか描けないため、
  // カード上部のグリッド（6艇横並び）とは別に「どの艇を見るか」を持つ
  const [openSection, setOpenSection] = useState(null);
  const [detailBoat, setDetailBoat] = useState(null);

  const sorted = [...(players ?? [])].sort((a, b) => a.number - b.number);
  const baselineRows = usableBaselineRows(baseline);
  if (sorted.length === 0 || baselineRows === null) return null;

  const baselineIndex = indexBaseline(baselineRows);
  const windowStart = baselineRows[0]?.window_start ?? null;
  const windowEnd = baselineRows[0]?.window_end ?? null;
  const columns = buildColumns(
    sorted,
    scopedByRacer,
    baselineIndex,
    entryCourseOf,
  );
  const loading = columns.every((c) => c.stats === null);

  // このカードには6艇の最良の金枠を付けない（race-detail-ui-unify plan §6）。
  // 安定率・出遅率・抜出はコースで水準が大きく違い（内ほど安定率が高く出遅率が低い）、
  // 生の値の最良はほぼ毎回内側の艇に付く。カードの見方は「同じコース・同じ級別の
  // 平均との差」なので、良し悪しは差の緑・赤で示す（PR #1187 ファン評価1周目 P1）

  return (
    <div className="rsc-card">
      <h3 className="rsc-title">{t("stConsideration.title")}</h3>
      <p className="rsc-sub">{t("stConsideration.subtitle")}</p>
      {windowStart && windowEnd && (
        <p className="rsc-window">
          {t("stConsideration.window", {
            start: windowStart,
            end: windowEnd,
          })}
        </p>
      )}
      {/* 選手側の値は表示中のレースより前の走だけで出している（BOA-603）。
          画面の日付が平均の期間だけだと、選手の数字にもレース後の走が入っていると
          読まれた（ファン評価2周目） */}
      <p className="rsc-window rsc-own-window">
        {t("stConsideration.ownWindow")}
      </p>

      {loading ? (
        <p className="rsc-loading">{t("wakuInfo.loading")}</p>
      ) : (
        <div className="rsc-grid-wrapper">
          <table className="rsc-grid">
            <GridHead columns={columns} />
            <tbody>
              <GradeRow
                columns={columns}
                flyingRowByBoat={flyingRowByBoat}
                currentMeetFlyingBoats={currentMeetFlyingBoats}
              />
              <RunsRow columns={columns} />
              <StableRow columns={columns} />
              <BreakoutRow columns={columns} />
              <LateRow columns={columns} />
            </tbody>
          </table>
        </div>
      )}

      {/* 折りたたみ: ST分布 / ST履歴（T3-3、2026-09-24ユーザー判断で案1を採用）。
          どちらも1艇ずつしか描けないため、上のグリッド（6艇横並び）とは別に
          「どの艇を見るか」のチップを持つ。既定は1号艇 */}
      {!loading && (
        <RaceStConsiderationCardFolds
          columns={columns}
          scopedByRacer={scopedByRacer}
          openSection={openSection}
          setOpenSection={setOpenSection}
          detailBoat={detailBoat}
          setDetailBoat={setDetailBoat}
        />
      )}

      <p className="rsc-caveat">{t("stConsideration.caveat")}</p>
    </div>
  );
}

export default RaceStConsiderationCard;
