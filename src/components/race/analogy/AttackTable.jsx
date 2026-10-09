import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import BoatBadge from "../BoatBadge";
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

function Cell({ o, refRate, refName }) {
  const { t } = useTranslation();
  if (!o || !o[1]) return <td>—</td>;
  const few = o[1] < SMALL_ATTACK;
  return (
    <td>
      <span className={few ? "af-few" : undefined}>
        {fmtRateCount(o)}
        {few && <small>{t(`${k}.few`)}</small>}
      </span>
      {refRate !== null && refRate !== undefined && (
        <em>
          {refName} {fmtPct(refRate)}
        </em>
      )}
    </td>
  );
}

/** 区分（展示タイム・モーター）ごとの表 */
function BandTable({ who, keys, heads, sections, refName }) {
  const { t } = useTranslation();
  return (
    <div className="af-tbl">
      <table className="af-mk-t">
        <thead>
          <tr>
            <th scope="col">{t(`${k}.rankHead`, { who })}</th>
            {heads.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => {
            const unclear = !clearDiff(
              s.by?.top?.[keys[0]],
              s.by?.low?.[keys[0]],
            );
            return [
              <tr key={`${s.key}-h`} className="af-grp">
                <th colSpan={keys.length + 1} scope="colgroup">
                  {s.label}
                  {unclear && (
                    <small className="af-uc">{t(`${k}.unclear`)}</small>
                  )}
                </th>
              </tr>,
              ...BANDS.map((b) => {
                const o = s.by?.[b];
                if (!o) return null;
                const isToday = s.todayBand === b;
                return (
                  <tr
                    key={`${s.key}-${b}`}
                    className={isToday ? "is-today" : undefined}
                  >
                    <th scope="row">
                      {t(`${k}.bands.${b}`)}
                      {isToday && <small>{t(`${k}.today`)}</small>}
                    </th>
                    {keys.map((kk) => (
                      <Cell
                        key={kk}
                        o={o[kk]}
                        refRate={rate(s.ref?.[b]?.[kk])}
                        refName={refName}
                      />
                    ))}
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ③攻めは決まった？（spec C-4）。形を選ぶまでは案内の1行。選ぶと攻める艇の表と1号艇の表
 * @param {{attack: object|null, refAttack: object|null, refName: string|null, slit: string, waku: boolean,
 *   exhibitionStage: boolean, exhRank: (number|null)[]|null, exhTime: (number|null)[]|null,
 *   motor: (number|null)[], motorRank: (number|null)[], scope: string, boats?: object|null}} props
 *   boats は API の boats（2〜6号艇の「構成＋その艇の級」の範囲。BOA-806）。あれば攻める艇の表・すぐ外の艇の1着は
 *   その艇の範囲の値、1号艇の表は1号艇の範囲の値
 */
export default function AttackTable({
  attack,
  refAttack,
  refName,
  slit,
  waku,
  exhibitionStage,
  exhRank,
  exhTime,
  motor,
  motorRank,
  scope,
  boats = null,
}) {
  const { t } = useTranslation();
  const head = (
    <h4 className="af-h4">
      <span className="af-stepn">3</span>
      {t(`${k}.attackHeading`)}
    </h4>
  );
  if (!waku)
    return (
      <>
        {head}
        <p className="af-foot">{t(`${k}.attackWakuOnly`)}</p>
      </>
    );
  if (slit === "any" || !attack?.[slit])
    return (
      <>
        {head}
        <p className="af-foot">{t(`${k}.attackGuide`)}</p>
      </>
    );
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
  const outer = att && att < 6 ? boats?.[att + 1]?.data?.winner?.[slit] : null;
  const outerRate = outer
    ? rate(outer)
    : all.n
      ? all.winner[att] / all.n
      : null;
  const formName = t(`${k}.forms.${slit}.name`);
  const exhOk = exhibitionStage && Array.isArray(exhRank);
  const range = (vals, d, unit = "") => {
    const ok = (vals ?? []).filter((v) => v !== null && v !== undefined);
    return ok.length
      ? `${Math.min(...ok).toFixed(d)}〜${Math.max(...ok).toFixed(d)}${unit}`
      : "—";
  };
  const sections = (boat, byExh, byMotor, refExh, refMotor) => [
    ...(exhOk
      ? [
          {
            key: "exh",
            label: t(`${k}.secExh`, {
              who: t("aiPredictionTab.analogy.boat", { n: boat }),
              v: exhTime?.[boat - 1]?.toFixed(2) ?? "—",
              rank: exhRank[boat - 1] ?? "—",
              range: range(exhTime, 2),
            }),
            by: byExh,
            ref: refExh,
            todayBand: rankBand(exhRank[boat - 1]),
          },
        ]
      : []),
    {
      key: "motor",
      label: t(`${k}.secMotor`, {
        who: t("aiPredictionTab.analogy.boat", { n: boat }),
        v: motor?.[boat - 1]?.toFixed(1) ?? "—",
        rank: motorRank[boat - 1] ?? "—",
        range: range(motor, 1, "%"),
      }),
      by: byMotor,
      ref: refMotor,
      todayBand: rankBand(motorRank[boat - 1]),
    },
  ];
  const natDiff = (by, key) =>
    by?.top?.[key]?.[1] && by?.low?.[key]?.[1]
      ? Math.round(Math.abs(rate(by.top[key]) - rate(by.low[key])) * 100)
      : null;
  const ov = F.overlap
    ? Object.entries(F.overlap)
        .map(([f, v]) => [f, rate(v) ?? 0])
        .sort((a, b) => b[1] - a[1])[0]
    : null;
  const techs = [
    ["makuri", "att_makuri_of_win"],
    ["makurizashi", "att_makurizashi_of_win"],
    ["sashi", "att_sashi_of_win"],
  ].filter(([, kk]) => all[kk]?.[0] > 0);
  const wins = all.att_win?.[0] ?? 0;
  const techText = techs
    .map(([n, kk]) =>
      wins >= 30
        ? `${t(`${k}.tech.${n}`)} ${fmtPct(rate(all[kk]))}`
        : `${t(`${k}.tech.${n}`)} ${all[kk][0]}`,
    )
    .join(t("aiPredictionTab.analogy.listSeparator"));
  const boatName = (b) => t("aiPredictionTab.analogy.boat", { n: b });
  return (
    <>
      {head}
      <p className="af-foot">{t(`${k}.attackNoRecord`)}</p>
      {att ? (
        <>
          <p className="af-sub">
            {t(`${k}.attacker`)}{" "}
            <b>
              <BoatBadge n={att} size="sm" />{" "}
              {t(`${k}.attackerName`, {
                boat: boatName(att),
                role: t(`${k}.role.${slit}`),
              })}
            </b>
            {t(`${k}.attackerNote`)}
          </p>
          <div className="af-big">
            <span>
              {t(`${k}.attackBig`, { form: formName, scope, b: att })}
            </span>
            <b>{fmtPct(rate(all.att_win))}</b>
            <small>
              {t(`${k}.attackBigSub`, {
                hits: fmtCount(all.att_win[0]),
                n: fmtCount(all.att_win[1]),
                b: att,
                top2: fmtPct(rate(all.att_top2)),
                nige: fmtPct(rate(all.b1_nige)),
              })}
              {att < 6 &&
                t(`${k}.attackOuter`, {
                  b: att + 1,
                  p: fmtPct(outerRate),
                })}
            </small>
          </div>
          <BandTable
            who={boatName(att)}
            keys={["att_win", "b1_nige"]}
            heads={[t(`${k}.colAttWin`, { b: att }), t(`${k}.colNige`)]}
            sections={sections(
              att,
              A.by_exh,
              A.by_motor,
              AR?.by_exh,
              AR?.by_motor,
            )}
            refName={refName}
          />
          {techText && (
            <p className="af-foot">
              {t(`${k}.attackTech`, { b: att, tech: techText, wins })}
            </p>
          )}
          <NoteList
            texts={[
              !DENT_FORMS.has(slit) &&
                A.att_lead?.[1] &&
                t(`${k}.attackLead`, { b: att, p: fmtPct(rate(A.att_lead)) }),
              AR &&
                natDiff(AR.by_exh, "att_win") !== null &&
                t(`${k}.attackNat`, {
                  b: att,
                  name: refName,
                  e: natDiff(AR.by_exh, "att_win"),
                  m: natDiff(AR.by_motor, "att_win"),
                }),
              A !== F &&
                t(`${k}.attackBoatScope`, {
                  b: att,
                  n: fmtCount(all.n),
                }),
            ]}
          />
        </>
      ) : (
        <p className="af-sub">{t(`${k}.noAttacker`, { form: formName })}</p>
      )}
      <div className="af-big">
        <span>{t(`${k}.b1Big`, { form: formName, scope })}</span>
        <b>{fmtPct(rate(F.all.b1_nige))}</b>
        <small>
          {t(`${k}.b1BigSub`, {
            hits: fmtCount(F.all.b1_nige[0]),
            n: fmtCount(F.all.b1_nige[1]),
            top2: fmtPct(rate(F.all.b1_top2)),
          })}
        </small>
      </div>
      <BandTable
        who={boatName(1)}
        keys={["b1_nige", "b1_top2"]}
        heads={[t(`${k}.colNige`), t(`${k}.colTop2`)]}
        sections={sections(
          1,
          F.b1_by_exh,
          F.b1_by_motor,
          R?.b1_by_exh,
          R?.b1_by_motor,
        )}
        refName={refName}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.counting`)}
        texts={[
          t(`${k}.attackFoot`),
          refName && t(`${k}.attackRef`, { name: refName }),
          ov &&
            t(`${k}.overlap`, {
              form: formName,
              p: fmtPct(ov[1]),
              other: t(`${k}.forms.${ov[0]}.name`),
            }),
        ]}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.caution`)}
        texts={[t(`${k}.b1ExhNote`), t(`${k}.notCause`)]}
      />
    </>
  );
}
