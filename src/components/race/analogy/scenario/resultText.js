// ④の見出し・括弧・基準の名前の文言（ScenarioTab から移した）
import { fmtPct } from "../../../../utils/analogyFormat";
import { k } from "./consts";

export function resultText({ t, E, sl, slit, scope, allOf, formName, base, c, whole }) {
  const core = E
    ? sl
      ? t(`${k}.coreEntryForm`, {
          entry: t(`${k}.ephConj.${E}`),
          form: formName(slit),
        })
      : t(`${k}.coreEntry`, { entry: t(`${k}.eph.${E}`) })
    : sl
      ? t(`${k}.coreForm`, { form: formName(slit) })
      : allOf(scope);
  const parens = [
    ...(E === "mae" ? [t(`${k}.maeNote`)] : []),
    ...(E && sl
      ? [
          t(`${k}.shareOf`, {
            of: t(`${k}.ephRaces.${E}`),
            p: fmtPct(base.n ? c.n / base.n : null),
          }),
        ]
      : []),
    ...(E || sl
      ? [
          // 展開シナリオは返還（F・L・欠場）のレースを除いて数えるので、差がつく材料の件数と合わない。ここで明記する
          t(`${k}.shareOfNoRefund`, {
            of: allOf(scope),
            p: fmtPct(whole.n ? c.n / whole.n : null),
          }),
        ]
      : []),
  ];
  const head = E || sl ? t(`${k}.headIn`, { scope, core }) : core;
  const baseName =
    sl && E
      ? t(`${k}.entryWhole`, { entry: t(`${k}.entryShort.${E}`) })
      : allOf(scope);
  return { core, parens, head, baseName };
}
