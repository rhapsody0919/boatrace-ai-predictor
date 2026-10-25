// scenes/scene4.mjs（605e3585a）の formsOfAvgSt と同じ
import { SLIT_FORMS, slitForms } from "./analogyScenario.js";
export function formsOfAvgSt(st) {
  if (!Array.isArray(st) || st.length !== 6 || st.some((v) => v === null || v === undefined)) return [];
  const hit = slitForms(st);
  return SLIT_FORMS.filter((f) => hit[f]);
}
