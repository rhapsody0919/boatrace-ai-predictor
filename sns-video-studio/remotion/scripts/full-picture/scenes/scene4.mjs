/**
 * 場面4「展開」の材料（型: 契約「場面4 展開（省略禁止）」）。龍神ソナー「展開」タブ（ScenarioTab）と同じ値。
 * STEP1 上帯「過去のレースでの進入はどんな傾向？」: 「前付けあり（1号艇イン）」の割合を囲う → 「前付けあり」を押して内訳（件数）
 * STEP2 平均ST「このコース」: スリット図でボートを平均STの位置まで走らせる →「数字で見る」→ 一致するスタートの形
 *   （hintRows・hintCardGroups の先頭の形。候補が複数なら先頭、無ければ「横一線」を参考に）
 * STEP3 その形の「1号艇が逃げた」「1号艇が2着以内」を囲う（scenario.attack[形].all）
 * STEP4 「結果はどう決まった？」→ 枠なり×その形の着順の流れ・よく出た3連単（場面2b と同じ見せ方、1回目だけ）
 * その後「全体」（コースを問わない平均ST）に切り替えて STEP2〜4 を繰り返す。同じ形なら2回目は形の一致まで。
 * 展開を省くのは禁止。材料が無ければ omitted に「省略禁止の場面に材料が無い」と記録し、報告する。
 */
import { HINT_FORM, SLIT_FORMS, hintCardGroups, hintRows } from "../../../../../src/utils/analogyScenario.js";
import { wilsonInterval } from "../../../../../src/utils/wilson.js";
import { BUTTON, barsRow, slitFormBox, statsRow } from "../../../src/fullPicture/pageLayout.js";
import { sonarSteps } from "./scene2b.mjs";
import { t } from "./common.mjs";

const sk = "aiPredictionTab.analogy.scenario";
const formName = (f) => t(`${sk}.forms.${f}.name`);
const p1 = (k, n) => (n ? ((k / n) * 100).toFixed(1) : "0.0");
const ENTRY_ROWS = ["waku", "mae", "inlost"];
const MAE_SUB = ["mae6", "mae5", "mae56", "maeOther"];
void HINT_FORM;

function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** STEP2〜4（版: course＝このコース、overall＝全体） */
function roundSteps(sc, data, version, prevForm) {
  const steps = [];
  const label = version === "course" ? "このコース" : "全体";
  const rows = hintRows(sc.hints, data.hints?.[version], version, wilsonInterval);
  const groups = hintCardGroups(rows);
  const candidates = groups.map((g) => g.form);
  const form = candidates[0] ?? "flat";
  const fallback = candidates.length === 0;
  const st = version === "course" ? data.course_st?.course_filled : data.course_st?.overall;
  const formIdx = SLIT_FORMS.indexOf(form);
  const f2 = {
    kind: "slit",
    version: label,
    form: formName(form),
    candidates: candidates.map(formName),
    fallback,
    stTop: st ? st.indexOf(Math.min(...st.filter((v) => v !== null))) + 1 : null,
  };
  steps.push({
    id: `s4-slit-${version}`,
    question: t(`${sk}.slitHeadingShort`),
    page: {
      kind: "slit",
      title: `平均ST「${label}」`,
      sub: version === "course" ? "今日のコースでの直近30走の平均ST" : "コースを問わない直近30走の平均ST",
      st: (st ?? []).map((v) => (v === null || v === undefined ? null : v)),
      boats: [1, 2, 3, 4, 5, 6],
      button: "数字で見る",
      forms: SLIT_FORMS.map((f) => ({ name: formName(f), on: f === form })),
    },
    press: { x: BUTTON.x + BUTTON.w / 2, y: BUTTON.y + BUTTON.h / 2 },
    revealOnPress: true,
    frames: [slitFormBox(formIdx)],
    facts: f2,
    lines: fallback
      ? [`${label}の並びは一致する形が無い`, `横一線を参考に`]
      : [`${label}の並びは${formName(form)}に一致`, candidates.length > 1 ? `候補は${candidates.map(formName).join("・")}` : null].filter(Boolean),
  });
  // 同じ形なら2回目は形の一致まで
  if (prevForm === form) return { steps, form, same: true };
  const atk = sc.attack?.[form]?.all;
  if (atk?.n) {
    const nige = atk.b1_nige;
    const top2 = atk.b1_top2;
    const f3 = { kind: "attack", boat: 1, form: formName(form), n: atk.n, nige: p1(nige[0], nige[1]), nigeK: nige[0], top2: p1(top2[0], top2[1]), top2K: top2[0] };
    steps.push({
      id: `s4-attack-${version}`,
      question: t(`${sk}.attackHeading`),
      page: {
        kind: "stats",
        title: `${formName(form)}のとき`,
        sub: `枠なりで${formName(form)}だったレース（${atk.n.toLocaleString("ja-JP")}件）`,
        rows: [
          { label: "1号艇が逃げた", value: `${f3.nige}%`, note: `${nige[0]}/${nige[1]}件` },
          { label: "1号艇が2着以内", value: `${f3.top2}%`, note: `${top2[0]}/${top2[1]}件` },
        ],
      },
      press: null,
      frames: [unionBox(statsRow(0), statsRow(1))],
      facts: f3,
      lines: [`${formName(form)}の${atk.n}件で1号艇の逃げ${f3.nige}%`, `2着以内は${f3.top2}%`],
    });
  }
  const cell = sc.cells?.waku?.forms?.[form];
  if (cell?.n && cell.tri) {
    const q = "結果はどう決まった？";
    // 2b と同じ見せ方は1回目だけ。2回目はよく出た3連単だけ
    const ss = sonarSteps(`s4-${version}`, cell.tri, cell.n, q, {});
    steps.push(...(prevForm === null ? ss : ss.filter((s) => s.id.endsWith("-tri"))));
  }
  return { steps, form, same: false };
}

/** @param {object} m 材料 JSON */
export function buildScene4(m) {
  const omitted = [];
  const data = m.api.scenario;
  const sc = data?.scenario;
  if (!sc?.cells) return { id: "scene4", steps: [], omitted: [{ where: "scene4", reason: "省略禁止の場面に材料が無い（展開の集計が無い）", mustReport: true }] };
  const steps = [];
  // STEP1 進入の傾向
  const all = sc.cells.all.forms.any.n;
  const nOf = (e) => sc.cells[e]?.forms?.any?.n ?? 0;
  const mae = nOf("mae");
  const f1 = { kind: "entry", boat: 1, n: all, maeK: mae, mae: p1(mae, all) };
  const q1 = "過去のレースでの進入はどんな傾向？";
  steps.push({
    id: "s4-entry",
    question: q1,
    page: {
      kind: "bars",
      title: t(`${sk}.entryHeading`),
      sub: `${all.toLocaleString("ja-JP")}件のうち`,
      max: 1,
      rows: ENTRY_ROWS.map((e) => ({ boat: null, label: t(`${sk}.entry.${e}`), value: nOf(e) / all, mark: null, text: `${p1(nOf(e), all)}%` })),
    },
    press: null,
    frames: [barsRow(1)],
    facts: f1,
    lines: [`前付けあり（1号艇イン）は${f1.mae}%`, `前付けがあっても1号艇がインを守った割合`],
  });
  const subs = MAE_SUB.map((e) => ({ e, n: nOf(e) }));
  const top = [...subs].sort((a, b) => b.n - a.n)[0];
  const fm = { kind: "entryMae", boats: (t(`${sk}.entryShort.${top.e}`).match(/[1-6]/g) ?? []).map(Number), n: mae, top: t(`${sk}.entryShort.${top.e}`), topK: top.n };
  steps.push({
    id: "s4-entry-mae",
    question: q1,
    page: {
      kind: "bars",
      title: "前付けあり（1号艇イン）の内訳",
      sub: `${mae.toLocaleString("ja-JP")}件`,
      max: Math.max(...subs.map((x) => x.n)) * 1.1 || 1,
      rows: subs.map((x) => ({ boat: null, label: t(`${sk}.entryShort.${x.e}`), value: x.n, mark: null, text: `${x.n}件` })),
    },
    press: { x: 400, y: barsRow(1).y + 50, from: { x: 860, y: 1320 } },
    revealOnPress: false,
    frames: [barsRow(subs.indexOf(top))],
    facts: fm,
    lines: [`内訳は${fm.top}が${top.n}件で最多`, `前付けあり${mae}件のうち`],
  });
  // STEP2〜4: このコース → 全体
  const r1 = roundSteps(sc, data, "course", null);
  steps.push(...r1.steps);
  const r2 = roundSteps(sc, data, "overall", r1.form);
  steps.push(...r2.steps);
  if (r2.same) omitted.push({ where: "scene4.overall", reason: "全体でも同じ形なので、2回目は形の一致まで（型どおり）" });
  return { id: "scene4", steps, omitted };
}
