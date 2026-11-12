import { BOAT_COLORS } from "../../utils/colors";
import { isRaceBeforeTodayJST } from "../../utils/dateUtils";
import { translateTechnique } from "./raceIndicators";
import Course1LossCard from "./Course1LossCard";
import NigeSimulationCard from "./NigeSimulationCard";
import {
  aggregateTechniqueDistribution,
  computeTechniqueAsOf,
} from "./RaceWakuInfoTabData";

function BoatChip({ player, active, onFocusBoat }) {
  const p = player;
  const color = BOAT_COLORS[p.number] || {};
  return (
    <button
      type="button"
      className={`rwit-boat-chip${active ? " is-active" : ""}`}
      // 艇番の丸は、選んだときだけ艇の文字色で塗り、数字はその反対の白黒にする。
      // ページの地の色のままだと、1・5号艇（黒字）はダークで、2・3・4・6号艇（白字）は
      // ライトで、丸の地と数字が同化した。数字を艇の色にすると、赤・青では白との
      // コントラストが約4:1で足りない（BOA-693）
      style={
        active
          ? {
              // 赤・青・緑は白い名前とのコントラストが足りないので、一段濃い色にする
              // （トークンがある艇だけ。白・黒・黄は公式の色のまま。BOA-703）
              background: color.bg
                ? `var(--boat-${p.number}-strong, ${color.bg})`
                : undefined,
              color: color.text,
              "--rwit-chip-num-bg": color.text,
              "--rwit-chip-num-fg":
                color.text === "#ffffff" ? "#000000" : "#ffffff",
            }
          : undefined
      }
      onClick={() => onFocusBoat(p.number)}
      aria-pressed={active}
    >
      <span className="rwit-boat-chip-num">{p.number}</span>
      <span className="rwit-boat-chip-name" translate="no">
        {p.name?.replace(/\s+/g, "")}
      </span>
    </button>
  );
}

export function BoatChipRow({ t, players, selectedNumber, onFocusBoat }) {
  return (
    <div
      className="rwit-chip-row"
      role="group"
      aria-label={t("wakuInfo.boatLabel")}
    >
      {players.map((p) => (
        <BoatChip
          key={p.number}
          player={p}
          active={selectedNumber === p.number}
          onFocusBoat={onFocusBoat}
        />
      ))}
    </div>
  );
}

function TechniqueBars({ t, distribution }) {
  return (
    <div className="rwit-bars">
      {distribution.map(({ technique, percentage }) => (
        <div key={technique} className="rwit-tech-row">
          <span className="rwit-tech-label">
            {translateTechnique(t, technique)}
          </span>
          <span className="rwit-bar-track">
            <span
              className="rwit-bar-fill rwit-bar-fill-neutral"
              style={{
                width: `${Math.max(2, Math.min(100, percentage))}%`,
              }}
            />
          </span>
          <span className="rwit-value">{percentage.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function TechniqueCard({ t, techniqueStats, distribution, asOf }) {
  return (
    <div className="rwit-card">
      <h3 className="rwit-card-title">{t("wakuInfo.kimariteTitle")}</h3>
      {asOf && (
        <p className="rwit-as-of">{t("wakuInfo.venueStatsAsOfToday", asOf)}</p>
      )}
      {distribution.length === 0 ? (
        <p className="rwit-empty">
          {techniqueStats === undefined
            ? t("wakuInfo.loading")
            : t("wakuInfo.noData")}
        </p>
      ) : (
        <TechniqueBars t={t} distribution={distribution} />
      )}
      <p className="rwit-caveat">{t("wakuInfo.kimariteCaveat")}</p>
    </div>
  );
}

// PC（1200px 以上）は逃げの棒と決まり手の棒を横に並べる（BOA-881）
export function LowerCards({
  t,
  raceId,
  players,
  scopedBefore,
  periodAnchor,
  sixBoatPeriod,
  nigeRows,
  techniqueStats,
}) {
  // 1号艇の選手（欠場・出走表が無く登番が取れないときはカードを出さない、BOA-1331）
  const course1Player =
    players.find((p) => Number(p.number) === 1 && p.racerId != null) ?? null;
  const raceIsPast = isRaceBeforeTodayJST(raceId);
  return (
    <div className="race-split">
      <div className="race-split__main">
        {/* 1号艇の選手本人の1コースでの まくられ・差され（BOA-1331、spec §1.8）。選んだ艇・6艇の表の期間とは独立 */}
        <Course1LossCard
          player={course1Player}
          records={course1Player ? scopedBefore[course1Player.racerId] : null}
          now={periodAnchor}
          sixBoatPeriod={sixBoatPeriod}
        />
        {/* 逃げシミュレーション（FR-6）。会場のコース単位の指標で、選手の選択とは独立 */}
        <NigeSimulationCard rows={nigeRows} asOfToday={raceIsPast} />
      </div>
      <div className="race-split__side">
        <TechniqueCard
          t={t}
          techniqueStats={techniqueStats}
          distribution={aggregateTechniqueDistribution(techniqueStats?.data)}
          asOf={computeTechniqueAsOf(raceIsPast, techniqueStats)}
        />
      </div>
    </div>
  );
}
