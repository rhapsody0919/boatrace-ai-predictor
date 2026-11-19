import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import ScenarioFold from "./ScenarioFold";
import AnalogySplit from "./AnalogySplit";
import BoatBadge from "../BoatBadge";
import SlitShapeIcon from "./SlitShapeIcon";
import { HintTable, HintCard } from "./SlitHintParts";
import { fmtCount, venueLabel } from "../../../utils/analogyFormat";
import { VENUE_FEW_RUNS } from "../../../utils/analogyAggregate";
import { hintCardGroups } from "../../../utils/analogyScenario";

const k = "aiPredictionTab.analogy.scenario";

/**
 * 今日のスタートの手がかり（spec C-2、承認モック mock-scenario-v1）。①が枠なり（かどの進入でも）のときの手がかり。
 * 枠なり以外を選ぶと注意を出す。当てはまる条件は棒2本と「②で…を選ぶ」のボタン。見方・注意・割合の出し方は
 * 一番下の折りたたみ（SlitHintNotes）に出す
 * @param {{courseSt: object, version: "course"|"overall", onVersion: (v: string) => void, rows: object[],
 *   exhibition: object|null, exhibitionStage: boolean, venue: number, selectedForm: string,
 *   onForm: (f: string) => void, waku: boolean}} props
 */
export default function SlitHint({
  courseSt,
  version,
  onVersion,
  rows,
  exhibition,
  exhibitionStage,
  venue,
  selectedForm,
  onForm,
  waku,
  players = null,
}) {
  const { t } = useTranslation();
  const lbl = useId();
  const [tip, setTip] = useState(false);
  const vals = version === "course" ? courseSt.course_filled : courseSt.overall;
  const ref =
    version === "course" ? (courseSt.venue_course_all?.mean ?? null) : null;
  const vName = venueLabel(venue, t);
  const exhByBoat = exhByBoatOf(exhibition, exhibitionStage);
  // 同じ形の条件は1枚にまとめ、段階ごとの棒にする（カド一撃: 1〜3コースより早い／0.02秒以上早い。承認モック）。
  // 並びは「なりやすい」→「はっきりしない」→「むしろなりにくい」（BOA-890）
  const groups = hintCardGroups(rows);
  return (
    <div className="af-hint">
      <HintHead waku={waku} />
      {/* PC では手がかりの絵（と切り替え）を左、当てはまる条件を右に（BOA-813） */}
      <AnalogySplit
        fig={
          <HintFig
            vals={vals}
            reference={ref}
            vName={vName}
            lbl={lbl}
            version={version}
            onVersion={onVersion}
            tip={tip}
            setTip={setTip}
          />
        }
      >
        <HintConds
          groups={groups}
          version={version}
          vals={vals}
          selectedForm={selectedForm}
          onForm={onForm}
        />
      </AnalogySplit>
      <ScenarioFold
        title={t(`${k}.hintTable`)}
        preview={t(`${k}.hintTablePreview`)}
      >
        <HintTable
          courseSt={courseSt}
          exhByBoat={exhByBoat}
          players={players}
          vName={vName}
        />
      </ScenarioFold>
    </div>
  );
}

/** 展示の進入コースごとの ST を艇番順に並べ直す（展示前・データ無しは null） */
function exhByBoatOf(exhibition, exhibitionStage) {
  return exhibitionStage && exhibition?.course_by_boat
    ? exhibition.course_by_boat.map((c) =>
        c ? exhibition.st_by_course[c - 1] : null,
      )
    : null;
}

/** 見出し・タグ・丸の数字の対応・枠なり以外の注意 */
function HintHead({ waku }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="af-hint-h">
        <h4 className="af-h4">{t(`${k}.hintHeading`)}</h4>
        <span className="af-hint-tags">
          <span className="af-info-tag">{t(`${k}.hintTagPast`)}</span>
          <span className="af-info-tag">{t(`${k}.hintTagWaku`)}</span>
        </span>
      </div>
      {/* 丸の数字が号艇かコースか分かるよう、対応を1回だけ（枠なりなので号艇＝コース。BOA-814 ユーザー指摘・案B） */}
      <p className="af-hint-map" data-testid="analogy-hint-map">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n}>
            <BoatBadge n={n} size="xs" />
            {t(n === 1 ? `${k}.hintMapFirst` : `${k}.hintMapRest`, { n })}
          </span>
        ))}
      </p>
      {!waku && <p className="af-warn">{t(`${k}.hintOther`)}</p>}
    </>
  );
}

/** 手がかりの絵・コース別／全体の切り替え・(i) の説明 */
function HintFig({
  vals,
  reference,
  vName,
  lbl,
  version,
  onVersion,
  tip,
  setTip,
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="af-hint-pic">
        <SlitShapeIcon
          st={vals}
          height={150}
          reference={reference}
          refLabel={t(`${k}.hintRefShort`, { venue: vName })}
        />
      </div>
      <div className="af-ctl-row">
        <span className="af-lbl" id={lbl}>
          {t(`${k}.hintSrc`)}
        </span>
        <div
          className="af-seg"
          role="group"
          aria-labelledby={lbl}
          data-af-control="slit_version"
        >
          {["course", "overall"].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={version === v}
              onClick={() => onVersion(v)}
            >
              {t(`${k}.hintSrcs.${v}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="af-ibtn"
          aria-expanded={tip}
          aria-label={t(`${k}.hintSrcAria`)}
          onClick={() => setTip((v) => !v)}
        >
          <span aria-hidden="true">i</span>
        </button>
      </div>
      {/* 選んでいる方の説明だけ1行。もう一方は (i)（UI/UX レビュー） */}
      <p className="af-foot">{t(`${k}.hintSrcDef.${version}`)}</p>
      {tip && (
        <p className="af-scn-tip">
          {t(`${k}.hintSrcDef.${version === "course" ? "overall" : "course"}`)}
        </p>
      )}
    </>
  );
}

/**
 * 結論（当てはまる条件）は図の直下。今日の値・形の絵・全体の点線で見せる（BOA-814、承認モック mock-hint-cards-v1）。
 * 見方・表・割合の出し方は折りたたみ
 */
function HintConds({ groups, version, vals, selectedForm, onForm }) {
  const { t } = useTranslation();
  return (
    <>
      <h4 className="af-h4">
        {t(`${k}.hintConds`, { src: t(`${k}.hintSrcs.${version}`) })}
      </h4>
      {groups.length > 0 && (
        <p className="af-foot">{t(`${k}.hintCondsNote`)}</p>
      )}
      <div className="af-hintcs" data-af-control="slit_form">
        {groups.length ? (
          groups.map(({ form, rows: rs }) => (
            <HintCard
              key={form}
              form={form}
              rows={rs}
              vals={vals}
              selected={selectedForm === form}
              onForm={onForm}
            />
          ))
        ) : (
          <p className="af-foot">{t(`${k}.hintNone`)}</p>
        )}
      </div>
    </>
  );
}

/**
 * 手がかりの見方・注意・割合の出し方（一番下の「割合の出し方・注意」の折りたたみの中。同じ名前の折りたたみが
 * 2つあったのを1つにまとめた。承認モック mock-scenario-v1）
 */
export function SlitHintNotes({
  courseSt,
  version,
  exhibitionStage,
  venue,
  scope,
  baseN,
  allA1 = false,
}) {
  const { t } = useTranslation();
  const vName = venueLabel(venue, t);
  const fewVenue = (courseSt.venue_n ?? [])
    .map((n, i) => (n !== null && n < VENUE_FEW_RUNS ? i + 1 : null))
    .filter(Boolean);
  const filled = (courseSt.course_n ?? [])
    .map((n, i) => (n < 5 ? i + 1 : null))
    .filter(Boolean);
  return (
    <>
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.howToRead`)}
        texts={[
          version === "course"
            ? t(`${k}.hintPicCourse`, { venue: vName }) +
              (allA1 ? t(`${k}.hintPicA1`) : "") +
              t(`${k}.hintPicTail`)
            : t(`${k}.hintPicOverall`),
          version === "course" &&
            filled.length > 0 &&
            t(`${k}.hintFilled`, {
              boats: filled.join(t("aiPredictionTab.analogy.listSeparator")),
            }),
        ]}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.caution`)}
        texts={[
          t(`${k}.hintVenueFoot`, { venue: vName }),
          fewVenue.length > 0 &&
            t(`${k}.hintFewVenue`, {
              boats: fewVenue.join(t("aiPredictionTab.analogy.listSeparator")),
            }),
          exhibitionStage ? t(`${k}.hintExhPost`) : t(`${k}.hintExhPre`),
        ]}
      />
      <NoteList
        title={t(`aiPredictionTab.analogy.notes.counting`)}
        texts={[
          t(`${k}.hintFoot`, {
            scope,
            n: fmtCount(baseN),
            few: baseN < 3000 ? t(`${k}.hintFew`) : "",
          }),
        ]}
      />
    </>
  );
}
