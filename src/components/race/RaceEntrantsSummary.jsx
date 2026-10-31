import { useTranslation } from "react-i18next";
import RacerLink from "./assist/RacerLink";
import BoatBadge from "./BoatBadge";
import "./RaceEntrantsSummary.css";

/**
 * レース詳細のタブの上に置く出走6艇の1〜2行（BOA-1189 GS01-c）。艇番・選手名（/racer/N へのリンク）・級別だけ。
 *
 * 2026-11-01 オーナー決定（A案）で、着順・展示タイムと順位・展示前の案内を外した。中身が結果タブ・直前情報・
 * 出走表と重なり、タブが下がりすぎたため（基本情報タブが 375px で y=708 → 1242）。並びは艇番のまま、色付けなし
 */
export default function RaceEntrantsSummary({ players }) {
  const { t } = useTranslation();
  const rows = (players ?? []).slice().sort((a, b) => a.number - b.number);
  if (rows.length === 0) return null;
  return (
    <ul
      className="race-entrants"
      data-testid="race-entrants"
      aria-label={t("raceSummary.title")}
    >
      {rows.map((p) => (
        <li key={p.number} className="race-entrants__item">
          <BoatBadge n={p.number} size="sm" />
          <RacerLink racerId={p.racerId} className="race-entrants__name">
            {(p.name ?? "").replace(/\s+/g, "")}
          </RacerLink>
          {p.grade && (
            <span className="race-entrants__grade" translate="no">
              {p.grade}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
