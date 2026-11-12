// 件数を押して開く元レース一覧の見出し（ScenarioTab の racePanel から移した）
import { k } from "./consts";

export function racePanelTitle(racePick, t) {
    const rk = `${k}.races.title`;
  return (
      racePick.kind === "first"
        ? t(`${rk}.first`, { b: racePick.boat })
        : racePick.kind === "tech"
          ? t(`${rk}.tech`, {
              tech: t(
                `aiPredictionTab.analogy.techniques.${racePick.tech}`,
                racePick.tech,
              ),
            })
          : racePick.kind === "manshu"
            ? t(`${rk}.manshu`)
            : racePick.kind === "tri"
              ? t(`${rk}.tri`, { combo: racePick.combo.join("-") })
              : t(`${rk}.band`, {
                  from: racePick.p + 1,
                  a: racePick.a,
                  to: racePick.p + 2,
                  b: racePick.b,
                })
  );
}
