import { useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import ScenarioFold from "./ScenarioFold";
import {
  AnswerBar,
  ScopeTag,
  TodayRow,
  BandTable,
  TechBand,
} from "./AttackTableParts";
import { hasToday, deriveAttack } from "./AttackTableLogic";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtPct, fmtRateCount } from "../../../utils/analogyFormat";

// 凹みの形では「攻める艇が内の艇より前に出た割合」を出さない（両隣より遅い定義なので100%になる。spec C-4、BOA-777）
const DENT_FORMS = new Set(["d1", "d2", "d3"]);
const k = "aiPredictionTab.analogy.scenario";

/** 攻める艇の箱の中身（範囲の札・棒・今日の区分・勝ち手・前に出た割合） */
function AttackerBox({
  d,
  slit,
  classes,
  classScope,
  exhOk,
  exhRank,
  motorRank,
}) {
  const { t } = useTranslation();
  const { att, A, AR, all, outerPair, scopeBoat } = d;
  return (
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
      {(hasToday(exhOk && exhRank[att - 1], A.by_exh) ||
        hasToday(motorRank[att - 1], A.by_motor)) && (
        <p className="af-atk-sep">{t(`${k}.atk.todayOf`, { b: att })}</p>
      )}
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
      <TechBand all={all} techs={d.techs} wins={d.wins} />
      {!DENT_FORMS.has(slit) && A.att_lead?.[1] ? (
        <AnswerBar
          label={t(`${k}.atk.lead`, { b: att })}
          pair={A.att_lead}
          color="#94a3b8"
        />
      ) : null}
    </div>
  );
}

/** 攻める艇の列（att あり: 見出し・説明・箱／att なし: 該当なしの文） */
function AttackerCol({ d, slit, tip, iBtn, ...box }) {
  const { t } = useTranslation();
  const { att } = d;
  if (!att)
    return (
      <p className="af-sub">
        {t(`${k}.noAttacker`, { form: t(`${k}.forms.${slit}.name`) })}
      </p>
    );
  return (
    <>
      <p className="af-atk-who">
        {t(`${k}.attacker`)} <BoatBadge n={att} size="sm" />{" "}
        {t(`${k}.attackerName`, {
          boat: t("aiPredictionTab.analogy.boat", { n: att }),
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
      <AttackerBox d={d} slit={slit} {...box} />
    </>
  );
}

/** 1号艇の列（件数の理由・箱・展示タイム割り引きの説明） */
function B1Col({
  d,
  classes,
  classScope,
  exhOk,
  exhRank,
  motorRank,
  scenarioN,
  tip,
  iBtn,
}) {
  const { t } = useTranslation();
  const { F, R } = d;
  return (
    <>
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
        {(hasToday(exhOk && exhRank[0], F.b1_by_exh) ||
          hasToday(motorRank[0], F.b1_by_motor)) && (
          <p className="af-atk-sep">{t(`${k}.atk.todayOf`, { b: 1 })}</p>
        )}
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
    </>
  );
}

/** 区分の表の行（展示後だけ展示タイムの行を足す） */
function bandRows(t, exhOk, exh, motor) {
  return [
    ...(exhOk ? [{ label: t(`${k}.atk.exh`), by: exh[0], ref: exh[1] }] : []),
    { label: t(`${k}.atk.motor`), by: motor[0], ref: motor[1] },
  ];
}

/** 攻める艇の表と、同じレースでの1号艇の逃げ */
function AttackBandPart({ d, classes, classScope, exhOk }) {
  const { t } = useTranslation();
  const { F, att, A, AR, all, scopeBoat } = d;
  if (!att) return null;
  return (
    <>
      <BandTable
        title={
          classScope
            ? t(`${k}.atk.tblAtt`, {
                b: att,
                cls: classes?.[scopeBoat - 1] ?? "—",
              })
            : t(`${k}.atk.tblAttAll`, { b: att })
        }
        who={t("aiPredictionTab.analogy.boat", { n: att })}
        keyName="att_win"
        rows={bandRows(
          t,
          exhOk,
          [A.by_exh, AR?.by_exh],
          [A.by_motor, AR?.by_motor],
        )}
      />
      {A !== F && (
        <p className="af-foot">
          {t(`${k}.atk.sameRacesNige`, {
            n: fmtCount(all.n),
            p: fmtRateCount(all.b1_nige),
          })}
        </p>
      )}
    </>
  );
}

/** 「区分で見る」の中身（凡例・攻める艇の表・1号艇の表・注） */
function AttackFoldBody({ d, slit, refName, classes, classScope, exhOk }) {
  const { t } = useTranslation();
  const { F, R, ov } = d;
  return (
    <>
      <p className="af-foot">
        {/* 比べる相手（全国）が無い範囲では ┊ の説明を出さない（ファン評価: 「┊＝—の率」と欠けて出た） */}
        {refName
          ? t(`${k}.atk.legend`, { name: refName })
          : t(`${k}.atk.legendNoRef`)}
      </p>
      <AttackBandPart
        d={d}
        classes={classes}
        classScope={classScope}
        exhOk={exhOk}
      />
      <BandTable
        title={
          classScope
            ? t(`${k}.atk.tblB1`, { cls: classes?.[0] ?? "—" })
            : t(`${k}.atk.tblB1All`)
        }
        who={t("aiPredictionTab.analogy.boat", { n: 1 })}
        keyName="b1_nige"
        rows={bandRows(
          t,
          exhOk,
          [F.b1_by_exh, R?.b1_by_exh],
          [F.b1_by_motor, R?.b1_by_motor],
        )}
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
    </>
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
  const d = deriveAttack({ attack, refAttack, slit, boats });
  const exhOk = exhibitionStage && Array.isArray(exhRank);
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
  const common = {
    d,
    classes,
    classScope,
    exhOk,
    exhRank,
    motorRank,
    tip,
    iBtn,
  };
  return (
    <>
      {/* PC では攻める艇の箱｜1号艇の箱を左右に（BOA-813） */}
      <div className="af-pair">
        <div className="af-pair-col">
          <AttackerCol {...common} slit={slit} />
        </div>
        <div className="af-pair-col">
          <B1Col {...common} scenarioN={scenarioN} />
        </div>
      </div>
      <ScenarioFold
        title={t(`${k}.atk.foldTitle`)}
        preview={
          refName ? t(`${k}.atk.foldPreview`) : t(`${k}.atk.foldPreviewNoRef`)
        }
      >
        <AttackFoldBody
          d={d}
          slit={slit}
          refName={refName}
          classes={classes}
          classScope={classScope}
          exhOk={exhOk}
        />
      </ScenarioFold>
    </>
  );
}
