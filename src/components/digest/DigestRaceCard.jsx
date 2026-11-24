/**
 * DigestRaceCard - 1レース1行のカード（BOA-402、screens.md C-3）
 *
 * 逃げ／まくり／逃がしの3セクションで使い回す。
 * **指標部分は props の分岐ではなく `children` で差し替える**（指標の種類が
 * 増えるたびに props が増えるのを避ける。screens.md §3 の共通化の判断根拠）。
 *
 * ## 折りたたみ（collapsible）
 *
 * 逃げは1日25枚並ぶため、既定を「要約だけの低いカード」にし、▼で詳細を開く。
 * `children` には `(expanded) => node` の関数も渡せる（`RateWithBaseline` の
 * `expanded` へそのまま流すため。要素を2つに分けると同じ値を2回書くことになる）。
 *
 * **タップ領域は分離する**（`RacerCompactRow` と同じ方針）。カード本体は
 * レース詳細への `<a>` のまま残し、▼ボタンだけが開閉する。カード全体を
 * トグルにするとレース詳細への導線が1タップ失われ、`<a>` でなくなることで
 * 新しいタブで開く・クロールされるという性質も落ちるため。
 * ▼はアンカーの**外**に置く（`<a>` の中に `<button>` は入れられない）。
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { isUnusedMotor } from "../../utils/motorUsage";
import {
  useTodayCaution,
  useTodayCautionVisible,
} from "../../hooks/useTodayCaution";
import InCautionBadge from "../race/InCautionBadge";
import "./DigestRaceCard.css";

function cardClassName(highlight, collapsible) {
  return `digest-card${highlight ? " digest-card--highlight" : ""}${
    collapsible ? " digest-card--collapsible" : ""
  }`;
}

function DigestCardHead({ row, venueName }) {
  return (
    <header className="digest-card__head">
      <span className="digest-card__race" translate="no">
        {venueName} {row.race_number}R
      </span>
      {row.start_time && (
        <span className="digest-card__deadline">
          締切 {String(row.start_time).slice(0, 5)}
        </span>
      )}
    </header>
  );
}

function DigestCardRacer({ row }) {
  return (
    <div className="digest-card__racer">
      <span className="digest-card__racer-id" translate="no">
        {row.racer_id}
      </span>
      <span className="digest-card__racer-name" translate="no">
        {row.racer_name}
      </span>
      {row.grade && (
        <span className="digest-card__grade" translate="no">
          {row.grade}
        </span>
      )}
      {row.boat_number && (
        <span className="digest-card__boat">枠{row.boat_number}</span>
      )}
    </div>
  );
}

/** 注意度の欄（BOA-822 task 35）。欄が画面に入ったら caution_visible */
function DigestCardCaution({ row }) {
  const visibleRef = useTodayCautionVisible(row);
  return (
    <span ref={visibleRef} className="digest-card__caution">
      イン崩れ注意度{" "}
      <InCautionBadge level={row.in_caution_level} pct={row.in_caution_pct} />
    </span>
  );
}

function DigestCardFoot({ row, t, caution }) {
  return (
    <footer className="digest-card__foot">
      {row.motor_2rate !== null && (
        <span>
          モーター2連率{" "}
          {/* 一度も使われていない新モーター（2連率0・会場公式の出走数0）は、0.0% だと「2着以内0回」と
              読まれるため「—」＋注記（BOA-702）。出走数が分からない行（会場公式に出走数が無い会場、
              マイグレーション131の前に生成した行）は従来どおり 0.0% */}
          {isUnusedMotor(Number(row.motor_2rate), {
            race_count: row.motor_race_count,
          })
            ? `—（${t("dataTable.motorUnusedNote")}）`
            : `${Number(row.motor_2rate).toFixed(1)}%`}
        </span>
      )}
      {caution.enabled && <DigestCardCaution row={row} />}
      {caution.showLegacy && row.volatility_percentile !== null && (
        <span>
          イン崩れ指数 {Math.round(Number(row.volatility_percentile))}%
        </span>
      )}
    </footer>
  );
}

function DigestCardToggle({ row, venueName, expanded, setExpanded }) {
  return (
    <button
      type="button"
      className="digest-card__toggle"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={`${venueName}${row.race_number}レース ${row.racer_name}の${
        expanded ? "詳細を閉じる" : "詳細を開く"
      }`}
    >
      <span aria-hidden="true">{expanded ? "▲" : "▼"}</span>
    </button>
  );
}

function DigestRaceCard({
  row,
  highlight = false,
  collapsible = false,
  children,
}) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [expanded, setExpanded] = useState(!collapsible);
  const venueName = t(`venues.${row.venue_code}`);
  const open = collapsible ? expanded : true;
  const body = typeof children === "function" ? children(open) : children;
  const caution = useTodayCaution(row);

  return (
    <article className={cardClassName(highlight, collapsible)}>
      <Link
        to={localize(`/race/${row.race_id}`)}
        className="digest-card__link"
        onClick={caution.onClick}
        aria-label={`${venueName}${row.race_number}レースの詳細`}
      >
        <DigestCardHead row={row} venueName={venueName} />

        <DigestCardRacer row={row} />

        {body}

        {open && <DigestCardFoot row={row} t={t} caution={caution} />}
      </Link>

      {collapsible && (
        <DigestCardToggle
          row={row}
          venueName={venueName}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      )}
    </article>
  );
}

export default DigestRaceCard;
