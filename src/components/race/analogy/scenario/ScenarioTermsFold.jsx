// ②の用語の折りたたみ（ScenarioSlitStep から移した）
import { useTranslation } from "react-i18next";
import ScenarioFold from "../ScenarioFold";
import { k } from "./consts";

export default function ScenarioTermsFold({ formName }) {
  const { t } = useTranslation();
  return (
            <ScenarioFold
              title={t(`${k}.termsFold`)}
              preview={t(`${k}.termsPreview`)}
            >
              <ul className="af-notes-ul">
                <li>{t(`${k}.termKado`)}</li>
                <li>{t(`${k}.termPic`)}</li>
                {["flat", "wall", "d2", "d3", "kado", "d1", "dash"].map((f) => (
                  <li key={f}>
                    {t(`${k}.slitDef`, {
                      form: formName(f),
                      def: t(`${k}.forms.${f}.def`),
                    })}
                  </li>
                ))}
                <li>{t(`${k}.termOverlap`)}</li>
                <li>{t(`${k}.termShare`)}</li>
              </ul>
            </ScenarioFold>
  );
}
