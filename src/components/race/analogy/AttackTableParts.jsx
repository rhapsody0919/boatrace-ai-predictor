import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  SMALL_ATTACK,
  clearDiff,
  rankBand,
} from "../../../utils/analogyScenario";
import { rate } from "./AttackTableLogic";

const k = "aiPredictionTab.analogy.scenario";
const BANDS = ["top", "mid", "low"];
const TECH_COLOR = {
  makuri: "#42a5f5",
  makurizashi: "#7e57c2",
  sashi: "#26a69a",
};

/** 50件未満の印（数字は薄くしない。UI/UX レビュー: 表の全部が薄くなり区別が働かなかった） */
function Few({ pair }) {
  const { t } = useTranslation();
  if (!pair || pair[1] >= SMALL_ATTACK) return null;
  return (
    <span className="af-atk-few" title={t(`${k}.atk.fewTitle`)}>
      {t(`${k}.atk.few`)}
    </span>
  );
}

/** 箱の中の答えの棒（ラベル・棒・%） */
function AnswerBar({ label, pair, color, main = false }) {
  const p = rate(pair);
  return (
    <div className={`af-atk-row${main ? " is-main" : ""}`}>
      <span className="af-atk-lb">{label}</span>
      <span className="af-atk-trk">
        <i style={{ width: `${(p ?? 0) * 100}%`, background: color }} />
      </span>
      <span className="af-atk-v af-num">{fmtPct(p)}</span>
    </div>
  );
}

/** 範囲の札（どのレースから出した数字か: 艇番・級・件数） */
function ScopeTag({ boat, cls, n, classScope = true }) {
  const { t } = useTranslation();
  // 級をそろえない範囲（会場の全レース等）は級を書かない（レビュー指摘）
  if (!classScope)
    return (
      <span className="af-scope-tag">
        {t(`${k}.scopeTagAll`, { n: fmtCount(n) })}
      </span>
    );
  return (
    <span className="af-scope-tag">
      <BoatBadge n={boat} size="xs" />
      {t(`${k}.atk.scopeTag`, {
        b: boat,
        cls: cls ?? "—",
        n: fmtCount(n),
      })}
    </span>
  );
}

/**
 * 今日の区分の1行（展示タイム・モーターを別の行に。UI/UX レビュー: 1行にすると片方が消えたように見える）
 * by は区分ごとの値、key はその中の率のキー
 */
function TodayRow({ label, rank, by, refBy, keyName, what, refName }) {
  const { t } = useTranslation();
  const band = rankBand(rank);
  if (!band || !by?.[band]) return null;
  const pair = by[band][keyName];
  const ref = refBy?.[band]?.[keyName];
  const unclear = !clearDiff(by.top?.[keyName], by.low?.[keyName]);
  return (
    <div className="af-atk-today af-num">
      <span>
        {t(`${k}.atk.todayRow`, {
          label,
          rank,
          band: t(`${k}.atk.band.${band}`),
          what,
        })}
      </span>
      <b>{fmtPct(rate(pair))}</b>
      {pair?.[1] ? (
        <small>
          {fmtCount(pair[0])}/{fmtCount(pair[1])}
        </small>
      ) : null}
      <Few pair={pair} />
      {ref?.[1] ? (
        <small className="af-atk-nat">
          {t(`${k}.atk.ref`, { name: refName, p: fmtPct(rate(ref)) })}
        </small>
      ) : null}
      {unclear && <span className="af-atk-uc">{t(`${k}.atk.unclear`)}</span>}
    </div>
  );
}

/** 区分（展示タイム・モーター × 上中下）の表。「区分で見る」の折りたたみの中 */
function BandTable({ title, who, rows, keyName }) {
  const { t } = useTranslation();
  return (
    <div className="af-tbl">
      <b className="af-atk-tt">{title}</b>
      <table className="af-mk-t">
        <thead>
          <tr>
            <th scope="col">{t(`${k}.rankHead`, { who })}</th>
            {BANDS.map((b) => (
              <th key={b} scope="col">
                {t(`${k}.atk.band.${b}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, by, ref }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {BANDS.map((b) => {
                const o = by?.[b]?.[keyName];
                const r = ref?.[b]?.[keyName];
                return (
                  <td key={b}>
                    {o?.[1] ? (
                      <>
                        {fmtPct(rate(o))} <Few pair={o} />
                        <small>
                          {fmtCount(o[0])}/{fmtCount(o[1])}
                          {r?.[1] ? ` ┊${fmtPct(rate(r))}` : ""}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 勝ち手の帯（まくり・まくり差し・差しの内訳）。勝ちがすべて抜き・恵まれのときは、帯も見出しも出さない（レビュー指摘） */
function TechBand({ all, techs, wins }) {
  const { t } = useTranslation();
  if (techs.length === 0) return null;
  return (
    <>
      <p className="af-foot">{t(`${k}.atk.wins`, { n: fmtCount(wins) })}</p>
      <div className="af-atk-stack" aria-hidden="true">
        {techs.map((n) => (
          <span
            key={n}
            style={{
              flex: all[`att_${n}_of_win`][0],
              background: TECH_COLOR[n],
            }}
          />
        ))}
      </div>
      <p className="af-foot">
        {techs
          .map(
            (n) =>
              `${t(`${k}.tech.${n}`)} ${
                wins >= 30
                  ? fmtPct(rate(all[`att_${n}_of_win`]))
                  : all[`att_${n}_of_win`][0]
              }`,
          )
          .join(t("aiPredictionTab.analogy.listSeparator"))}
      </p>
    </>
  );
}

export { AnswerBar, ScopeTag, TodayRow, BandTable, TechBand };
