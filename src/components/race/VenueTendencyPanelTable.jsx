/**
 * VenueTendencyPanelTable - VenueTendencyPanel の表（4指標×6艇）
 * カテゴリ分割指標（決まり手/負け決まり手）はセルごとのサンプル数が薄くなりやすいため、
 * n未満（MIN_CATEGORY_SAMPLE）は「データ不足」表示にし数値を隠す。
 * 2値指標（トップスタート率/展示最速転換率）はn数併記のみで常に表示する。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { translateTechnique } from "./raceIndicators";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";

const MIN_CATEGORY_SAMPLE = 20;
const BOATS = [1, 2, 3, 4, 5, 6];

function pickTopTechnique(entry) {
  if (!entry || !entry.techniques || entry.techniques.length === 0) return null;
  return entry.techniques[0];
}

function CategoryCell({ byBoat, boat }) {
  const { t } = useTranslation();
  const top = pickTopTechnique(byBoat[boat]);
  if (!top) return <span className="vtp-empty">—</span>;
  if (top.count < MIN_CATEGORY_SAMPLE) {
    return (
      <span className="vtp-value">
        <span className="vtp-insufficient">
          {t("venueTendency.insufficientData")}
        </span>
        <span className="vtp-n">
          {t("venueTendency.sampleCount", { n: top.count })}
        </span>
      </span>
    );
  }
  return (
    <span className="vtp-value">
      <span className="vtp-main">
        {translateTechnique(t, top.technique)} {Math.round(top.percentage)}%
      </span>
      <span className="vtp-n">
        {t("venueTendency.sampleCount", { n: top.count })}
      </span>
    </span>
  );
}

function TopStartCell({ topStartByBoat, boat }) {
  const { t } = useTranslation();
  const row = topStartByBoat.get(boat);
  if (!row || !row.race_count) return <span className="vtp-empty">—</span>;
  return (
    <span className="vtp-value">
      <span className="vtp-main">{Math.round(row.top_start_rate)}%</span>
      <span className="vtp-n">
        {t("venueTendency.sampleCount", { n: row.race_count })}
      </span>
    </span>
  );
}

function ExhibitionTopCell({ exhibitionTopByBoat, boat }) {
  const { t } = useTranslation();
  const row = exhibitionTopByBoat.get(boat);
  if (!row || !row.fastest_count) return <span className="vtp-empty">—</span>;
  return (
    <span className="vtp-value">
      <span className="vtp-main">{Math.round(row.win_rate_when_fastest)}%</span>
      <span className="vtp-n">
        {t("venueTendency.sampleCount", { n: row.fastest_count })}
      </span>
    </span>
  );
}

function LabelLink({ to, className, tab, fullKey, shortKey }) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className={className}
      onClick={() =>
        trackEvent("deep_link_click", {
          tab,
          link_source: "venue_tendency_panel",
        })
      }
    >
      <span className="vtp-label-full">{t(fullKey)}</span>
      <span className="vtp-label-short">{t(shortKey)}</span>
    </Link>
  );
}

function TendencyRow({
  deepLink,
  tab,
  fullKey,
  shortKey,
  hintKey,
  extra,
  renderCell,
}) {
  return (
    <tr>
      <td className="vtp-label-cell">
        <LabelLink
          to={deepLink(tab)}
          className="vtp-label-link"
          tab={tab}
          fullKey={fullKey}
          shortKey={shortKey}
        />
        {extra}
        <TermHintButton termKey={hintKey} />
      </td>
      {BOATS.map((boat) => (
        <td key={boat} className="vtp-cell">
          {renderCell(boat)}
        </td>
      ))}
    </tr>
  );
}

function TendencyHead() {
  const { t } = useTranslation();
  return (
    <thead>
      <tr>
        <th className="vtp-label-th"></th>
        {BOATS.map((boat) => {
          const color = BOAT_COLORS[boat] || {};
          return (
            <th
              key={boat}
              className="vtp-boat-th"
              style={{ background: color.bg, color: color.text }}
            >
              {t("venueTendency.boatLabel", { n: boat })}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export default function VenueTendencyPanelTable({
  venueCode,
  raceId,
  techniqueByBoat,
  losingByBoat,
  topStartByBoat,
  exhibitionTopByBoat,
}) {
  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?venue_code=${venueCode}&tab=${tab}`;

  const nigeLink = (
    <LabelLink
      to={deepLink("nige")}
      className="vtp-nige-link"
      tab="nige"
      fullKey="venueTendency.nigeLink"
      shortKey="venueTendency.nigeLinkShort"
    />
  );

  return (
    <div className="vtp-table-wrapper">
      <table className="vtp-table">
        <TendencyHead />
        <tbody>
          <TendencyRow
            deepLink={deepLink}
            tab="technique"
            fullKey="venueTendency.rowTechnique"
            shortKey="venueTendency.rowTechniqueShort"
            hintKey="venueTendencyTechnique"
            extra={nigeLink}
            renderCell={(boat) => (
              <CategoryCell byBoat={techniqueByBoat} boat={boat} />
            )}
          />
          <TendencyRow
            deepLink={deepLink}
            tab="topstart"
            fullKey="venueTendency.rowTopStart"
            shortKey="venueTendency.rowTopStartShort"
            hintKey="venueTendencyTopStart"
            renderCell={(boat) => (
              <TopStartCell topStartByBoat={topStartByBoat} boat={boat} />
            )}
          />
          <TendencyRow
            deepLink={deepLink}
            tab="losing"
            fullKey="venueTendency.rowLosing"
            shortKey="venueTendency.rowLosingShort"
            hintKey="venueTendencyLosing"
            renderCell={(boat) => (
              <CategoryCell byBoat={losingByBoat} boat={boat} />
            )}
          />
          <TendencyRow
            deepLink={deepLink}
            tab="extime"
            fullKey="venueTendency.rowExhibitionTop"
            shortKey="venueTendency.rowExhibitionTopShort"
            hintKey="venueTendencyExhibitionTop"
            renderCell={(boat) => (
              <ExhibitionTopCell
                exhibitionTopByBoat={exhibitionTopByBoat}
                boat={boat}
              />
            )}
          />
        </tbody>
      </table>
    </div>
  );
}
