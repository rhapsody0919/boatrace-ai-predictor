import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import "./AttackDefenseTable.css";

// 全国平均 攻撃分布（14,155レース集計）
const DEFAULT_ATTACK = {
  1: { nige: 0.954, nuki: 0.044, megumare: 0.002 },
  2: {
    sashi: 0.531,
    makuri: 0.352,
    nuki: 0.063,
    nige: 0.039,
    makurizashi: 0.015,
  },
  3: {
    makuri: 0.45,
    makurizashi: 0.341,
    sashi: 0.124,
    nuki: 0.054,
    nige: 0.031,
  },
  4: {
    makuri: 0.486,
    makurizashi: 0.248,
    sashi: 0.193,
    nuki: 0.046,
    nige: 0.027,
  },
  5: {
    makurizashi: 0.548,
    makuri: 0.177,
    nuki: 0.113,
    sashi: 0.097,
    nige: 0.065,
  },
  6: {
    makuri: 0.4,
    makurizashi: 0.267,
    nuki: 0.167,
    sashi: 0.133,
    nige: 0.033,
  },
};

// 全国平均 防御分布
const DEFAULT_DEFENSE = {
  1: {
    sashi: 0.28,
    makuri: 0.25,
    makurizashi: 0.22,
    nuki: 0.15,
    megumare: 0.1,
  },
};

// 表示する行の定義（文言は i18n キーで管理）
const TECHNIQUE_ROWS = [
  {
    key: "nige",
    label1Key: "attackDefense.nige",
    labelOtherKey: null,
    course1Only: true,
  },
  {
    key: "sashi",
    label1Key: "attackDefense.sashiDefense",
    labelOtherKey: "attackDefense.sashiAttack",
  },
  {
    key: "makuri",
    label1Key: "attackDefense.makuriDefense",
    labelOtherKey: "attackDefense.makuriAttack",
  },
  {
    key: "makurizashi",
    label1Key: "attackDefense.makurizashiDefense",
    labelOtherKey: "attackDefense.makurizashiAttack",
  },
  {
    key: "other",
    label1Key: "attackDefense.other",
    labelOtherKey: "attackDefense.other",
    composite: ["nuki", "megumare"],
  },
];

function calcCount(dist, technique, base) {
  if (!dist || !base) return null;
  const rate = dist[technique];
  if (rate == null || rate === 0) return 0;
  return Math.round(rate * base);
}

function calcCompositeCount(dist, keys, base) {
  if (!dist || !base) return null;
  let sum = 0;
  for (const k of keys) {
    const rate = dist[k];
    if (rate != null) sum += rate;
  }
  return Math.round(sum * base);
}

// 全枠番合計勝利数を算出（5未満ならデフォルト分布が使われている）
function getTotalWins(stats) {
  const counts = stats.wakuRaceCounts;
  if (!counts) return 0;
  let sum = 0;
  for (const c of Object.values(counts)) {
    sum += c.wins || 0;
  }
  return sum;
}

// 全国平均値のデフォルト率を取得
function getDefaultRate(row, waku) {
  if (waku === 1) {
    if (row.key === "nige") return DEFAULT_ATTACK[1]?.nige || 0;
    if (row.composite) {
      let sum = 0;
      for (const k of row.composite) sum += DEFAULT_DEFENSE[1]?.[k] || 0;
      return sum;
    }
    return DEFAULT_DEFENSE[1]?.[row.key] || 0;
  }
  if (row.composite) {
    let sum = 0;
    for (const k of row.composite) sum += DEFAULT_ATTACK[waku]?.[k] || 0;
    return sum;
  }
  return DEFAULT_ATTACK[waku]?.[row.key] || 0;
}

// セルの値: 回数/分母
// 戻り値: string | { type: 'default'|'reference', value: string }
function getCellValue(row, waku, stats, wakuStr, wins, total) {
  if (row.course1Only && waku !== 1) return "-";
  if (!total) return "-";

  const totalWins = getTotalWins(stats);
  const isInsufficient = totalWins < 2;
  const isReference = totalWins >= 2 && totalWins < 5;

  // データ不足: 全国平均値を%で薄字表示
  if (isInsufficient) {
    const rate = getDefaultRate(row, waku);
    if (rate === 0) return "-";
    return { type: "default", value: `${Math.round(rate * 100)}%` };
  }

  if (waku === 1) {
    if (row.key === "nige") {
      const dist = stats.attackDistribution?.[wakuStr];
      const count = calcCount(dist, "nige", wins);
      const val = count != null ? `${count}/${total}` : "-";
      return isReference ? { type: "reference", value: val } : val;
    }
    // 防御: 負けた回数が分母
    const losses = total - wins;
    const dist = stats.defenseDistribution?.[wakuStr];
    if (!dist || !losses) {
      const val = `0/${total}`;
      return isReference ? { type: "reference", value: val } : val;
    }
    const count = row.composite
      ? calcCompositeCount(dist, row.composite, losses)
      : calcCount(dist, row.key, losses);
    const val = count != null ? `${count}/${total}` : "-";
    return isReference ? { type: "reference", value: val } : val;
  } else {
    const dist = stats.attackDistribution?.[wakuStr];
    if (!dist || !wins) {
      const val = `0/${total}`;
      return isReference ? { type: "reference", value: val } : val;
    }
    const count = row.composite
      ? calcCompositeCount(dist, row.composite, wins)
      : calcCount(dist, row.key, wins);
    const val = count != null ? `${count}/${total}` : "-";
    return isReference ? { type: "reference", value: val } : val;
  }
}

// getCellValueの戻り値をReact要素に変換
function renderCellValue(val) {
  if (typeof val === "object" && val !== null) {
    if (val.type === "default") {
      return <span className="ad-default-value">{val.value}</span>;
    }
    if (val.type === "reference") {
      return (
        <span className="ad-reference-value">
          {val.value}
          <sup>※</sup>
        </span>
      );
    }
  }
  return val;
}

const TECH_LABEL_KEYS = {
  sashi: {
    defense: "attackDefense.sashiDefense",
    attack: "attackDefense.sashiAttack",
  },
  makuri: {
    defense: "attackDefense.makuriDefense",
    attack: "attackDefense.makuriAttack",
  },
  makurizashi: {
    defense: "attackDefense.makurizashiDefense",
    attack: "attackDefense.makurizashiAttack",
  },
};

// 実データから凡例の例文を生成
function buildExamples(sorted, t) {
  const examples = [];

  // 1コースの防御例（差され/まくられ/捲差されで回数>0のもの）
  const c1 = sorted[0];
  if (c1) {
    const counts = c1.wakuRaceCounts?.["1"];
    const total = counts?.total || 0;
    const wins = counts?.wins || 0;
    const losses = total - wins;
    const defDist = c1.defenseDistribution?.["1"];
    if (defDist && losses > 0 && total > 0) {
      for (const tech of ["sashi", "makuri", "makurizashi"]) {
        const rate = defDist[tech];
        if (rate && rate > 0) {
          const count = Math.round(rate * losses);
          if (count > 0) {
            const label = t(TECH_LABEL_KEYS[tech].defense);
            examples.push({
              title: t("attackDefense.exampleDefenseTitle", {
                label,
                count,
                total,
              }),
              desc: t("attackDefense.exampleDefenseDesc", {
                count,
                total,
                attackLabel: t(TECH_LABEL_KEYS[tech].attack),
              }),
            });
            break;
          }
        }
      }
    }
  }

  // 2-6コースの攻撃例（差し/まくり/まくり差しで回数>0のもの）
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const waku = s.boatNumber;
    const wakuStr = String(waku);
    const counts = s.wakuRaceCounts?.[wakuStr];
    const wins = counts?.wins || 0;
    const total = counts?.total || 0;
    const atkDist = s.attackDistribution?.[wakuStr];
    if (!atkDist || !wins || !total) continue;

    for (const tech of ["sashi", "makuri", "makurizashi"]) {
      const rate = atkDist[tech];
      if (rate && rate > 0) {
        const count = Math.round(rate * wins);
        if (count > 0) {
          const label = t(TECH_LABEL_KEYS[tech].attack);
          examples.push({
            title: t("attackDefense.exampleAttackTitle", {
              waku,
              label,
              count,
              total,
            }),
            desc: t("attackDefense.exampleAttackDesc", {
              waku,
              label,
              count,
              total,
            }),
          });
          break;
        }
      }
    }
    if (examples.length >= 2) break;
  }

  return examples;
}

function RowLabel({ row }) {
  const { t } = useTranslation();

  if (row.course1Only) {
    return <span className="ad-tech-nige">{t(row.label1Key)}</span>;
  }
  return (
    <>
      <span className="ad-tech-defense">{t(row.label1Key)}</span>
      <span className="ad-tech-sep">/</span>
      <span className="ad-tech-attack">{t(row.labelOtherKey)}</span>
    </>
  );
}

// 見出しは「号艇」表示。枠番キーは BOA-284 で決定（実進入コースではない。src/utils/racerStats.js）
export default function AttackDefenseTable({ racerStats, players }) {
  const { t } = useTranslation();

  if (!racerStats || racerStats.length < 6) return null;

  const sorted = [...racerStats].sort((a, b) => a.boatNumber - b.boatNumber);

  const getPlayerName = (boatNumber) => {
    const p = players?.find(
      (pl) => pl.number === boatNumber || pl.boatNumber === boatNumber,
    );
    return p?.name || t("attackDefense.boatDefault", { number: boatNumber });
  };

  return (
    <div className="ad-section">
      <h4>{t("attackDefense.title")}</h4>

      {/* Desktop table */}
      <div className="ad-table-desktop">
        <table className="ad-table">
          <thead>
            <tr>
              <th></th>
              {sorted.map((s) => {
                const waku = s.boatNumber;
                const color = BOAT_COLORS[waku] || {};
                return (
                  <th
                    key={waku}
                    className={waku === 1 ? "ad-course1-th" : ""}
                    style={{
                      background: waku === 1 ? "#f1f5f9" : color.bg,
                      color: waku === 1 ? "#1e293b" : color.text,
                    }}
                  >
                    <div>{t("analysis.boatN", { n: waku })}</div>
                    <div className="ad-role-sub">
                      {waku === 1
                        ? t("attackDefense.defense")
                        : t("attackDefense.attack")}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ad-label-cell">{t("attackDefense.racer")}</td>
              {sorted.map((s) => (
                <td key={s.boatNumber} translate="no">
                  {getPlayerName(s.boatNumber)}
                </td>
              ))}
            </tr>

            <tr>
              <td className="ad-label-cell">
                {t("attackDefense.winsPerStarts")}
              </td>
              {sorted.map((s) => {
                const waku = String(s.boatNumber);
                const counts = s.wakuRaceCounts?.[waku];
                return (
                  <td key={s.boatNumber}>
                    {counts ? `${counts.wins || 0}/${counts.total || 0}` : "-"}
                  </td>
                );
              })}
            </tr>

            {TECHNIQUE_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="ad-label-cell">
                  <RowLabel row={row} />
                </td>
                {sorted.map((s) => {
                  const waku = s.boatNumber;
                  const wakuStr = String(waku);
                  const counts = s.wakuRaceCounts?.[wakuStr];
                  const wins = counts?.wins || 0;
                  const total = counts?.total || 0;

                  return (
                    <td key={s.boatNumber}>
                      {renderCellValue(
                        getCellValue(row, waku, s, wakuStr, wins, total),
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: scrollable table (same as desktop) */}
      <div className="ad-table-mobile">
        <table className="ad-table">
          <thead>
            <tr>
              <th className="ad-sticky-col"></th>
              {sorted.map((s) => {
                const waku = s.boatNumber;
                const color = BOAT_COLORS[waku] || {};
                return (
                  <th
                    key={waku}
                    className={waku === 1 ? "ad-course1-th" : ""}
                    style={{
                      background: waku === 1 ? "#f1f5f9" : color.bg,
                      color: waku === 1 ? "#1e293b" : color.text,
                    }}
                  >
                    {t("analysis.boatN", { n: waku })}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ad-label-cell ad-sticky-col">
                {t("attackDefense.racer")}
              </td>
              {sorted.map((s) => (
                <td key={s.boatNumber} translate="no">
                  {getPlayerName(s.boatNumber)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="ad-label-cell ad-sticky-col">
                {t("attackDefense.winsPerStarts")}
              </td>
              {sorted.map((s) => {
                const waku = String(s.boatNumber);
                const counts = s.wakuRaceCounts?.[waku];
                return (
                  <td key={s.boatNumber}>
                    {counts ? `${counts.wins || 0}/${counts.total || 0}` : "-"}
                  </td>
                );
              })}
            </tr>
            {TECHNIQUE_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="ad-label-cell ad-sticky-col">
                  <RowLabel row={row} />
                </td>
                {sorted.map((s) => {
                  const waku = s.boatNumber;
                  const wakuStr = String(waku);
                  const counts = s.wakuRaceCounts?.[wakuStr];
                  const wins = counts?.wins || 0;
                  const total = counts?.total || 0;

                  return (
                    <td key={s.boatNumber}>
                      {renderCellValue(
                        getCellValue(row, waku, s, wakuStr, wins, total),
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Legend sorted={sorted} />
    </div>
  );
}

function Legend({ sorted }) {
  const { t } = useTranslation();
  const examples = buildExamples(sorted, t);

  return (
    <div className="ad-legend">
      <p>
        <strong>{t("attackDefense.winsPerStarts")}</strong>
        {t("attackDefense.legendWinsDesc")}
      </p>
      <p>
        <span className="ad-tech-defense">{t("attackDefense.legendRed")}</span>
        {t("attackDefense.legendRedDesc")}
      </p>
      <p>
        <span className="ad-tech-attack">{t("attackDefense.legendBlue")}</span>
        {t("attackDefense.legendBlueDesc")}
      </p>
      <p>
        <span className="ad-tech-nige">{t("attackDefense.legendGreen")}</span>
        {t("attackDefense.legendGreenDesc")}
      </p>
      {examples.length > 0 && (
        <div className="ad-legend-example">
          {examples.map((ex, i) => (
            <div key={i}>
              <p className="ad-legend-example-title">{ex.title}</p>
              <p>{ex.desc}</p>
            </div>
          ))}
        </div>
      )}
      <div className="ad-legend-supplement">
        <span className="ad-default-value">28%</span>{" "}
        {t("attackDefense.supplementDefault")}
        <br />
        3/5<sup className="ad-reference-sup">※</sup>{" "}
        {t("attackDefense.supplementReference")}
      </div>
    </div>
  );
}
