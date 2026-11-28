/**
 * 全国勝率の変化ランキングの差の棒（部品化 G4 T-21、2026-11-28 オーナーが before/after で承認）。
 * 差の大きさで並ぶ表なので、差（今の全国勝率 − 約90日前）を灰の棒で伸ばす。上がった人は左端から右へ、
 * 下がった人は右端から左へ。棒の先に符号つきの差、右に「約90日前 → 現在」（plan.md §14: ↑↓ と緑赤の文字をやめる）。
 * 表だった頃はスマホで差の列が横スクロールの外に隠れていた。行のクラス motor-ranking-row と
 * 選手ページのリンク racer-page-link-inline は既存の試験が見るので残す。データは props で受け取る（§13）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./FormRankingDiffBars.css";

const MINUS = "−";
const signed = (d) =>
  `${d > 0 ? "+" : d < 0 ? MINUS : "±"}${Math.abs(d).toFixed(2)}`;

// 物差し: 差の最大を 0.25 刻みで切り上げる（下限 0.5）。棒は枠の 58% まで（375px でも棒の先に「−1.82」が入る幅を残す）
const scaleOf = (rows) =>
  Math.max(
    0.5,
    Math.ceil(Math.max(0, ...rows.map((r) => Math.abs(r.delta ?? 0))) * 4) / 4,
  );
const SPAN = 58;

function DiffRow({ row, scale, venueLabel, t }) {
  const width = Math.max((Math.abs(row.delta) / scale) * SPAN, 1);
  return (
    <li className="motor-ranking-row frd-row">
      <span className="frd-who">
        <Link
          className="frd-name"
          to={`/winning-technique?venue_code=${row.venue_code}&race_id=${row.race_id}&tab=racer`}
          translate="no"
        >
          {row.player_name?.replace(/\s+/g, "")}
        </Link>
        <span className="frd-sub">
          <span>
            {venueLabel(row)} {row.race_number}R
          </span>
          <Link
            to={`/racer/${row.racer_id}`}
            className="racer-page-link-inline"
          >
            {t("analysis.racerPageShort")}
          </Link>
        </span>
      </span>
      <span className="frd-track">
        <span className="frd-axis" aria-hidden="true" />
        <span
          className="frd-bar"
          aria-hidden="true"
          style={{ width: `${width}%` }}
        />
        <span className="frd-diff" style={{ "--frd-at": `${width}%` }}>
          {signed(row.delta)}
        </span>
      </span>
      <span className="frd-values">
        {row.past_win_rate?.toFixed(2)} → <b>{row.win_rate?.toFixed(2)}</b>
      </span>
    </li>
  );
}

export default function FormRankingDiffBars({
  title,
  rows,
  direction,
  venueLabel,
  emptyMessage,
}) {
  const { t } = useTranslation();
  const scale = scaleOf(rows);
  return (
    <section className={`frd frd--${direction}`}>
      <h3 className="frd-title">
        {title}
        <span className="frd-title-note">{t("analysis.formRanking.vs90")}</span>
      </h3>
      {rows.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <>
          <div className="frd-head" aria-hidden="true">
            <span />
            <span className="frd-head-bar">
              {t(
                direction === "up"
                  ? "analysis.formRanking.barRise"
                  : "analysis.formRanking.barFall",
              )}
            </span>
            <span className="frd-head-values">
              {t("analysis.formRanking.pastNow")}
            </span>
          </div>
          <ol className="frd-rows">
            {rows.map((row) => (
              <DiffRow
                key={row.racer_id}
                row={row}
                scale={scale}
                venueLabel={venueLabel}
                t={t}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
