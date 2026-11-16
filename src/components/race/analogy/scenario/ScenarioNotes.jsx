// 末尾の注意書き（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import NoteList, { NotesFold } from "../NoteList";
import { SlitHintNotes } from "../SlitHint";
import { fmtCount } from "../../../../utils/analogyFormat";
import { k } from "./consts";

export default function ScenarioNotes({
  classScope,
  sc,
  data,
  version,
  exhibitionStage,
  raceId,
  scope,
  baseN,
  today,
}) {
  const { t } = useTranslation();
  return (
      <NotesFold title={t("aiPredictionTab.analogy.notes.methodCaution")}>
        {/* 級をそろえない範囲（会場の全レース等）では、どの数字も同じ集めたレースなので対応の表を出さない */}
        {classScope && (
          <>
            <h4 className="af-h4">{t(`${k}.scopeMapHeading`)}</h4>
            <div className="af-tbl">
              <table className="af-mk-t af-scope-map">
                <thead>
                  <tr>
                    <th scope="col">{t(`${k}.scopeMapPart`)}</th>
                    <th scope="col">{t(`${k}.scopeMapB1`)}</th>
                    <th scope="col">{t(`${k}.scopeMapOwn`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["attOwn", false],
                    ["attB1", true],
                    ["barB1", true],
                    ["barOwn", false],
                    ["rest", true],
                  ].map(([id, b1]) => (
                    <tr key={id}>
                      <th scope="row">{t(`${k}.scopeMap.${id}`)}</th>
                      <td>{b1 ? "○" : ""}</td>
                      <td>{b1 ? "" : "○"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.caution`)}
          texts={[
            t(`${k}.foot`, { n: fmtCount(sc.n_refund_excluded ?? 0) }),
            t(`${k}.resultNotSplit`),
          ]}
        />
        <h4 className="af-h4">{t(`${k}.notesHintHeading`)}</h4>
        <SlitHintNotes
          courseSt={data.course_st}
          version={version}
          exhibitionStage={exhibitionStage}
          venue={Number(String(raceId).split("-")[3])}
          scope={scope}
          baseN={baseN}
          allA1={(today?.classes ?? []).every((x) => x === "A1")}
        />
      </NotesFold>
  );
}
