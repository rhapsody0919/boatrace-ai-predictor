/**
 * 場面4「展開」の材料（型: 契約「場面4 展開（省略禁止）」）。龍神ソナー「展開」タブ（ScenarioTab）と同じ値。
 * STEP1 上帯「過去のレースでの進入はどんな傾向？」: 「前付けあり（1号艇イン）」の割合を囲う → 「前付けあり」を押して内訳（件数）
 * STEP2 平均ST「このコース」: スリット図でボートを平均STの位置まで走らせる →「数字で見る」→ 当てはまるスタートの形
 *   （平均ST をサイトと同じ型の定義 slitForms で判定する。2026-10-21 オーナー決定 BOA-979。平均ST の手がかりの条件からの写像はやめた。
 *   複数当てはまれば SLIT_FORMS の順の先頭。どれにも当てはまらなければ「どの形にも当てはまらない」で、横一線に寄せない）
 * STEP3 その形の「1号艇が逃げた」「1号艇が2着以内」を囲う（scenario.attack[形].all）。当てはまる形が無ければ出さない
 *   （Web の展開タブも、形を選ぶまで攻めの数を出さない）
 * STEP4 「結果はどう決まった？」→ 枠なり×その形（無ければ「どの形でも」）の着順の流れ・よく出た3連単（場面2b と同じ見せ方、1回目だけ）
 * その後「全体」（コースを問わない平均ST）に切り替えて STEP2〜4 を繰り返す。同じ形なら2回目は形の一致まで。
 * 展開を省くのは禁止。材料が無ければ omitted に「省略禁止の場面に材料が無い」と記録し、報告する。
 */
import { SLIT_FORMS, slitForms } from "../../../../../src/utils/analogyScenario.js";
import { BUTTON, barsRow, slitFormBox, statsRow } from "../../../src/fullPicture/pageLayout.js";
import { sonarSteps } from "./scene2b.mjs";
import { t } from "./common.mjs";
import { fitFirst } from "../fit.mjs";

const sk = "aiPredictionTab.analogy.scenario";
const formName = (f) => t(`${sk}.forms.${f}.name`);
const p1 = (k, n) => (n ? ((k / n) * 100).toFixed(1) : "0.0");
const ENTRY_ROWS = ["waku", "mae", "inlost"];
const MAE_SUB = ["mae6", "mae5", "mae56", "maeOther"];

/**
 * 平均ST（コース順、秒）に当てはまる形（サイトと同じ slitForms の線）。SLIT_FORMS の順。欠けがあれば空
 * @param {(number|null)[]|null|undefined} st
 * @returns {string[]}
 */
export function formsOfAvgSt(st) {
  if (!Array.isArray(st) || st.length !== 6 || st.some((v) => v === null || v === undefined)) return [];
  const hit = slitForms(st);
  return SLIT_FORMS.filter((f) => hit[f]);
}

function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** STEP2〜4（版: course＝このコース、overall＝全体）。prevForm は1回目の形（1回目は undefined。形が無いときの null と区別する） */
function roundSteps(sc, data, version, prevForm) {
  const steps = [];
  const label = version === "course" ? "このコース" : "全体";
  // 字幕では、会場のコースと取り違えないよう「進入コース別」「全コース」と言う（wording-editor P2）
  const say = version === "course" ? "進入コース別" : "全コース";
  const st = version === "course" ? data.course_st?.course_filled : data.course_st?.overall;
  const candidates = formsOfAvgSt(st);
  // 当てはまらなければ null（横一線に寄せない。2026-10-21 オーナー決定 BOA-979）
  const form = candidates[0] ?? null;
  const fallback = form === null;
  const formIdx = SLIT_FORMS.indexOf(form);
  const others = candidates.slice(1).map(formName);
  const f2 = {
    kind: "slit",
    version: label,
    form: form ? formName(form) : null,
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
    frames: fallback ? [] : [slitFormBox(formIdx)],
    facts: f2,
    // 今日の6艇（選手）の平均ST と分かるように（2026-10-20 オーナー）。形の定義そのもので判定したので「当てはまる」と言う
    lines: fallback
      ? fitFirst([`今日の6艇（${say}）の並びは`, "どの形にも当てはまらない"], [`${label}の並びは`, "どの形にも当てはまらない"])
      : fitFirst(
          [`今日の6艇（${say}）は${formName(form)}に当てはまる`, others.length ? `ほかに${others.join("・")}にも当てはまる` : null],
          [`今日の6艇（${say}）は${formName(form)}`, others.length ? `ほかに${others.join("・")}にも当てはまる` : null],
          [`${label}の並びは${formName(form)}`, others.length ? `ほかに${others.join("・")}も` : null],
        ),
  });
  // 同じ形なら2回目は形の一致まで
  if (prevForm !== undefined && prevForm === form) return { steps, form, same: true, conclusion: null };
  const atk = form ? sc.attack?.[form]?.all : null;
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
  // 形が無ければ「どの形でも」（Web の展開タブの既定と同じ）
  const cell = sc.cells?.waku?.forms?.[form ?? "any"];
  const cond = form ? `枠なりで${formName(form)}だったレース` : "枠なりで進入したレース";
  if (cell?.n && cell.tri) {
    const q = "結果はどう決まった？";
    // 2b と同じ見せ方は1回目だけ。2回目はよく出た3連単だけ
    const ss = sonarSteps(`s4-${version}`, cell.tri, cell.n, q, {});
    steps.push(...(prevForm === undefined ? ss : ss.filter((s) => s.id.endsWith("-tri"))));
    // 入口版の結論の1拍（着順の流れの1着の段に、形の条件を書き足す）
    const flow = ss.find((s) => s.id === `s4-${version}-flow`);
    if (flow) {
      const f = { ...flow.facts, form: form ? formName(form) : null };
      return {
        steps,
        form,
        same: false,
        conclusion: {
          ...flow,
          id: "s4-conclusion",
          page: { ...flow.page, sub: `${cond}（${cell.n.toLocaleString("ja-JP")}件）` },
          facts: f,
          // 形が無ければ入口版の問いも「同じ並び」と言わない
          entryQuestion: form ? null : "過去のレースは、どう決まった？",
          // 過去の集計と分かるように「過去」を入れる（今日の結果と読まれない。2026-10-20 x-channel・youtube-channel P1）
          lines: [
            form ? `${formName(form)}の過去${f.n.toLocaleString("ja-JP")}件で1着最多は${f.boat}号艇` : `枠なりの過去${f.n.toLocaleString("ja-JP")}件で1着最多は${f.boat}号艇`,
            `${f.count.toLocaleString("ja-JP")}件（${f.pct}%）`,
          ],
        },
      };
    }
  }
  return { steps, form, same: false, conclusion: null };
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
    lines: fitFirst(
      [`過去${all.toLocaleString("ja-JP")}件で前付けあり（1号艇イン）は${f1.mae}%`, `前付けがあっても1号艇がインを守った割合`],
      [`過去${all.toLocaleString("ja-JP")}件中、前付けあり（1号艇イン）${f1.mae}%`, `前付けがあっても1号艇がインを守った割合`],
      [`過去${all.toLocaleString("ja-JP")}件中、前付けあり${f1.mae}%`, `前付けがあっても1号艇がインを守った割合`],
      [`過去のレースで前付けあり（1号艇イン）は${f1.mae}%`, `前付けがあっても1号艇がインを守った割合`],
      [`過去の前付けあり（1号艇イン）は${f1.mae}%`, `前付けがあっても1号艇がインを守った割合`],
    ),
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
  const r1 = roundSteps(sc, data, "course", undefined);
  steps.push(...r1.steps);
  const r2 = roundSteps(sc, data, "overall", r1.form);
  steps.push(...r2.steps);
  if (r2.same) omitted.push({ where: "scene4.overall", reason: "全体でも同じ形なので、2回目は形の一致まで（型どおり）" });
  return { id: "scene4", steps, omitted, conclusion: r1.conclusion ?? null };
}

/** 攻める艇（画面の「役」: カド一撃・カド受け凹み・ダッシュ勢先行は4コース、イン凹みは2コース、2コース凹みは3コース） */
const ROLE_BOAT = { kado: 4, d3: 4, dash: 4, d1: 2, d2: 3 };

/**
 * 場面4の展開の鍵の艇（場面6・8 が使う）。「このコース」の形の攻める艇と1号艇。攻める艇の無い形は1号艇だけ
 * @returns {{form: string, boats: number[]}}
 */
export function keyBoatsOf(m) {
  const data = m.api.scenario;
  const sc = data?.scenario;
  if (!sc?.cells) return { form: null, boats: [1] };
  // 場面4と同じ判定（平均ST を slitForms で）。当てはまらなければ形は null で、鍵は1号艇だけ（横一線に寄せない）
  const form = formsOfAvgSt(data.course_st?.course_filled)[0] ?? null;
  const role = form ? ROLE_BOAT[form] : null;
  return { form, boats: role ? [role, 1] : [1] };
}
