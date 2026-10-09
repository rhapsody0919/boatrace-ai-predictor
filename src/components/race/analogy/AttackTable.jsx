import { useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import ScenarioFold from "./ScenarioFold";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtPct, fmtRateCount } from "../../../utils/analogyFormat";
import {
  SMALL_ATTACK,
  clearDiff,
  rankBand,
} from "../../../utils/analogyScenario";

// 凹みの形では「攻める艇が内の艇より前に出た割合」を出さない（両隣より遅い定義なので100%になる。spec C-4、BOA-777）
const DENT_FORMS = new Set(["d1", "d2", "d3"]);
const k = "aiPredictionTab.analogy.scenario";
const BANDS = ["top", "mid", "low"];
const rate = (o) => (o && o[1] ? o[0] / o[1] : null);
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
      {t(`${k}.atk.scopeTag`, { cls: cls ?? "—", n: fmtCount(n) })}
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

/**
 * ③攻めは決まった？（spec C-4、承認モック mock-scenario-v1 の案A、2026-10-09）。答えを先に棒で出し、数字の箱ごとに
 * 範囲の札（どのレースから出した数字か）を付ける。攻める艇の箱は、その艇の級をそろえた範囲（boats、BOA-806）が
 * あればその値、無ければ1号艇の範囲の値。区分の表は「区分で見る」に畳み、今日の区分の2行だけ常に出す
 * @param {{attack: object|null, refAttack: object|null, refName: string|null, slit: string, waku: boolean,
 *   exhibitionStage: boolean, exhRank: (number|null)[]|null, motorRank: (number|null)[], classes: (string|null)[],
 *   boats?: object|null, classScope?: boolean, scenarioN?: number|null}} props scenarioN は②④の件数（③の1号艇の箱と
 *   比べ、少ない理由をすぐ近くに出す） classScope は級をそろえる範囲（VC・NC・NCR）か
 */
export default function AttackTable({
  attack,
  refAttack,
  refName,
  slit,
  waku,
  exhibitionStage,
  exhRank,
  motorRank,
  classes,
  boats = null,
  classScope = true,
  scenarioN = null,
}) {
  const { t } = useTranslation();
  const [tip, setTip] = useState({});
  const toggle = (id) => setTip((s) => ({ ...s, [id]: !s[id] }));
  if (!waku) return <p className="af-sub">{t(`${k}.attackWakuOnly`)}</p>;
  if (slit === "any" || !attack?.[slit])
    return <p className="af-sub">{t(`${k}.attackGuide`)}</p>;
  const F = attack[slit];
  const R = refAttack?.[slit] ?? null;
  const att = F.attacker;
  // 攻める艇の値（BOA-806）: その艇の級をそろえた範囲があればそちら。無ければ1号艇の範囲の値
  const own = att ? boats?.[att] : null;
  const A = own?.data?.attack?.[slit] ?? F;
  const AR = own?.data?.attack?.[slit]
    ? (own.reference?.attack?.[slit] ?? null)
    : R;
  const all = A.all;
  // すぐ外の艇の1着は、攻める艇の値をその艇の範囲で出しているときだけ外の艇の範囲の値にする
  const outerPair =
    att && att < 6
      ? A !== F
        ? (boats?.[att + 1]?.data?.winner?.[slit] ?? null)
        : [all.winner[att], all.n]
      : null;
  const exhOk = exhibitionStage && Array.isArray(exhRank);
  const boatName = (b) => t("aiPredictionTab.analogy.boat", { n: b });
  const scopeBoat = A !== F ? att : 1;
  const techs = ["makuri", "makurizashi", "sashi"].filter(
    (n) => all[`att_${n}_of_win`]?.[0] > 0,
  );
  const wins = all.att_win?.[0] ?? 0;
  const iBtn = (id, label) => (
    <button
      type="button"
      className="af-ibtn"
      aria-expanded={!!tip[id]}
      aria-label={label}
      onClick={() => toggle(id)}
    >
      <span aria-hidden="true">i</span>
    </button>
  );
  const ov = F.overlap
    ? Object.entries(F.overlap)
        .map(([f, v]) => [f, rate(v) ?? 0])
        .sort((a, b) => b[1] - a[1])[0]
    : null;
  return (
    <>
      {att ? (
        <>
          <p className="af-atk-who">
            {t(`${k}.attacker`)} <BoatBadge n={att} size="sm" />{" "}
            {t(`${k}.attackerName`, {
              boat: boatName(att),
              role: t(`${k}.role.${slit}`),
            })}
            {iBtn("att", t(`${k}.atk.attackerAria`))}
          </p>
          {tip.att && (
            <p className="af-scn-tip">
              {t(`${k}.attackerNote`)}
              {t("aiPredictionTab.analogy.listComma")}
              {t(`${k}.attackNoRecord`)}
            </p>
          )}
          <div className="af-atk-box" data-testid="analogy-attack-box">
            <ScopeTag
              boat={scopeBoat}
              cls={classes?.[scopeBoat - 1]}
              n={all.n}
              classScope={classScope}
            />
            <AnswerBar
              label={t(`${k}.atk.attWin`, { b: att })}
              pair={all.att_win}
              color={SCOPE_LINE[att]}
              main
            />
            <AnswerBar
              label={t(`${k}.atk.attTop2`, { b: att })}
              pair={all.att_top2}
              color={SCOPE_LINE[att]}
            />
            {outerPair && (
              <AnswerBar
                label={t(`${k}.atk.outerWin`, { b: att + 1 })}
                pair={outerPair}
                color={SCOPE_LINE[att + 1]}
              />
            )}
            <p className="af-atk-sep">{t(`${k}.atk.todayOf`, { b: att })}</p>
            {exhOk && (
              <TodayRow
                label={t(`${k}.atk.exh`)}
                rank={exhRank[att - 1]}
                by={A.by_exh}
                refBy={AR?.by_exh}
                keyName="att_win"
                what={t(`${k}.atk.attWinShort`, { b: att })}
                refName={t(`${k}.atk.refShort`)}
              />
            )}
            <TodayRow
              label={t(`${k}.atk.motor`)}
              rank={motorRank[att - 1]}
              by={A.by_motor}
              refBy={AR?.by_motor}
              keyName="att_win"
              what={t(`${k}.atk.attWinShort`, { b: att })}
              refName={t(`${k}.atk.refShort`)}
            />
            {wins > 0 && (
              <>
                <p className="af-foot">
                  {t(`${k}.atk.wins`, { n: fmtCount(wins) })}
                </p>
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
            )}
            {!DENT_FORMS.has(slit) && A.att_lead?.[1] ? (
              <AnswerBar
                label={t(`${k}.atk.lead`, { b: att })}
                pair={A.att_lead}
                color="#94a3b8"
              />
            ) : null}
          </div>
        </>
      ) : (
        <p className="af-sub">
          {t(`${k}.noAttacker`, { form: t(`${k}.forms.${slit}.name`) })}
        </p>
      )}
      {/* ③は平均STが6艇そろうレースだけから出すので、②④より件数が少ない。理由を箱のすぐ上に（ファン評価: 畳んだ中にしか無かった） */}
      {scenarioN !== null && F.all.n < scenarioN && (
        <p className="af-foot">
          {t(`${k}.atk.countDiff`, {
            n: fmtCount(F.all.n),
            m: fmtCount(scenarioN),
          })}
        </p>
      )}
      <div className="af-atk-box" data-testid="analogy-attack-box">
        <ScopeTag
          boat={1}
          cls={classes?.[0]}
          n={F.all.n}
          classScope={classScope}
        />
        <AnswerBar
          label={t(`${k}.atk.b1Nige`)}
          pair={F.all.b1_nige}
          color={SCOPE_LINE[1]}
          main
        />
        <AnswerBar
          label={t(`${k}.atk.b1Top2`)}
          pair={F.all.b1_top2}
          color={SCOPE_LINE[1]}
        />
        <p className="af-atk-sep">{t(`${k}.atk.todayOf`, { b: 1 })}</p>
        {exhOk && (
          <>
            <TodayRow
              label={t(`${k}.atk.exh`)}
              rank={exhRank[0]}
              by={F.b1_by_exh}
              refBy={R?.b1_by_exh}
              keyName="b1_nige"
              what={t(`${k}.atk.nigeShort`)}
              refName={t(`${k}.atk.refShort`)}
            />
          </>
        )}
        <TodayRow
          label={t(`${k}.atk.motor`)}
          rank={motorRank[0]}
          by={F.b1_by_motor}
          refBy={R?.b1_by_motor}
          keyName="b1_nige"
          what={t(`${k}.atk.nigeShort`)}
          refName={t(`${k}.atk.refShort`)}
        />
        {/* 1号艇の展示タイムの割り引きは展示前も出す（spec C-4 Q-E。レビュー指摘: 展示前に消えていた） */}
        <p className="af-foot af-atk-inote">
          {iBtn("b1exh", t(`${k}.atk.b1ExhAria`))}
          {t(`${k}.atk.b1ExhShort`)}
        </p>
        {tip.b1exh && <p className="af-scn-tip">{t(`${k}.b1ExhNote`)}</p>}
      </div>
      <ScenarioFold
        title={t(`${k}.atk.foldTitle`)}
        preview={
          refName ? t(`${k}.atk.foldPreview`) : t(`${k}.atk.foldPreviewNoRef`)
        }
      >
        <p className="af-foot">
          {/* 比べる相手（全国）が無い範囲では ┊ の説明を出さない（ファン評価: 「┊＝—の率」と欠けて出た） */}
          {refName
            ? t(`${k}.atk.legend`, { name: refName })
            : t(`${k}.atk.legendNoRef`)}
        </p>
        {att && (
          <BandTable
            title={
              classScope
                ? t(`${k}.atk.tblAtt`, {
                    b: att,
                    cls: classes?.[scopeBoat - 1] ?? "—",
                  })
                : t(`${k}.atk.tblAttAll`, { b: att })
            }
            who={boatName(att)}
            keyName="att_win"
            rows={[
              ...(exhOk
                ? [{ label: t(`${k}.atk.exh`), by: A.by_exh, ref: AR?.by_exh }]
                : []),
              { label: t(`${k}.atk.motor`), by: A.by_motor, ref: AR?.by_motor },
            ]}
          />
        )}
        {att && A !== F && (
          <p className="af-foot">
            {t(`${k}.atk.sameRacesNige`, {
              n: fmtCount(all.n),
              p: fmtRateCount(all.b1_nige),
            })}
          </p>
        )}
        <BandTable
          title={
            classScope
              ? t(`${k}.atk.tblB1`, { cls: classes?.[0] ?? "—" })
              : t(`${k}.atk.tblB1All`)
          }
          who={boatName(1)}
          keyName="b1_nige"
          rows={[
            ...(exhOk
              ? [
                  {
                    label: t(`${k}.atk.exh`),
                    by: F.b1_by_exh,
                    ref: R?.b1_by_exh,
                  },
                ]
              : []),
            {
              label: t(`${k}.atk.motor`),
              by: F.b1_by_motor,
              ref: R?.b1_by_motor,
            },
          ]}
        />
        <ul className="af-notes-ul">
          <li>{t(`${k}.atk.footTie`)}</li>
          {ov && (
            <li>
              {t(`${k}.overlap`, {
                form: t(`${k}.forms.${slit}.name`),
                p: fmtPct(ov[1]),
                other: t(`${k}.forms.${ov[0]}.name`),
              })}
            </li>
          )}
        </ul>
      </ScenarioFold>
    </>
  );
}
