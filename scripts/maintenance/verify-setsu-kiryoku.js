/**
 * YouTube Shorts「節の機力」（sns-video-studio/remotion/src/setsuKiryoku/）の型の決まりを確かめる（外部接続なし）。
 * - 見本の bundle（samples/motor_gap・motor_up・final_six）が検査（checkBundle）を通る
 * - 章の尺が約15秒（14〜16秒）、節の機力の3つの型は4章・border（準優に残れるか）は3章
 * - border: 3人・順位が cut より下・得点率が線より下・要る着の形・R と号艇を確かめる
 * - 検査が P0 を落とす: 禁止語（risk-rules.json）・言い切りの語・z・画面の文に bundle に無い数・
 *   2連率の「下から何番目」と all の食い違い・前半後半の平均と runs の食い違い・6艇でない・走の値の範囲
 * - 配置の推定: hook・close の文が最小 36px で 720px に収まり y1400 を越えない、2連率の札が x60〜900 に収まる
 * 実際の描画の箱（x≤940・y≤1400）は SetsuKiryoku.jsx が各コマで DOM を測って止める（Remotion の描画のとき）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import {
  RIGHT,
  LEFT,
  SAFE,
  VARIANTS,
  SIX,
  barsLayout,
  checkBundle,
  closeLayout,
  daysLabel,
  fmtAvg,
  hookLayout,
  sixChipW,
  sixPitch,
  timeline,
} from "../../sns-video-studio/remotion/src/setsuKiryoku/model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SK = join(ROOT, "sns-video-studio/remotion/src/setsuKiryoku");
const rules = JSON.parse(
  readFileSync(join(ROOT, "sns-video-studio/remotion/risk-rules.json"), "utf8"),
).rules;
const load = (v) =>
  JSON.parse(readFileSync(join(SK, "samples", `${v}.json`), "utf8"));
const check = (b) => checkBundle(b, { rules, matchRiskRules });
const clone = (o) => JSON.parse(JSON.stringify(o));
const fails = (b, re, label) => {
  const why = check(b);
  assert.ok(
    why.some((w) => re.test(w)),
    `${label} を落とすはず: ${JSON.stringify(why)}`,
  );
};

let n = 0;
const t = (name, fn) => {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
};

for (const v of VARIANTS) {
  t(`見本 ${v} が検査を通る`, () => {
    const b = load(v);
    assert.equal(b.variant, v);
    assert.deepEqual(check(b), []);
  });
  t(`${v} の尺は約15秒・${v === "border" ? 3 : 4}章`, () => {
    const tl = timeline(v);
    assert.equal(tl.chapters.length, v === "border" ? 3 : 4);
    assert.ok(
      tl.total >= 14 * 30 && tl.total <= 16 * 30,
      `尺 ${tl.total / 30}秒`,
    );
  });
  t(`${v} の hook・close が y${SAFE.bottom} より上`, () => {
    const b = load(v);
    const h = hookLayout(b);
    const c = closeLayout(b);
    for (const l of [
      ...h.lines,
      ...(h.sub ? [h.sub] : []),
      ...c.lines,
      c.tail,
    ]) {
      assert.ok(l.size >= 36, `字が小さい: ${l.text}`);
      assert.ok(
        l.y + l.size * 1.3 <= SAFE.bottom,
        `y${SAFE.bottom} を越える: ${l.text}`,
      );
    }
  });
}

t("禁止語（risk-rules.json）を画面・題・説明欄で落とす", () => {
  const b = load("motor_gap");
  const a = clone(b);
  a.texts.close[0] = "競艇の数字は平凡でも";
  fails(a, /banned-term-kyoutei/, "画面の「競艇」");
  const c = clone(b);
  c.youtube.title += " 必ず当たる";
  fails(c, /guaranteed-hit/, "題の「必ず当たる」");
  const d = clone(b);
  d.youtube.description += "\n万舟券も";
  fails(d, /gambling-incitement/, "説明欄の「万舟券」");
  const e = clone(b);
  e.youtube.description += "\n稼げる";
  fails(e, /gambling-incitement/, "説明欄の「稼げる」");
  const f = clone(b);
  f.youtube.description = f.youtube.description.replace(
    "#ボートレース",
    "#ボートレース #競艇",
  );
  assert.deepEqual(
    check(f),
    [],
    "説明欄の末尾のハッシュタグ #競艇 は例外（code-style.md 例外2）",
  );
});

t("言い切りの語と z を落とす", () => {
  const b = load("motor_up");
  for (const w of ["足が良い", "上がった", "化けた", "節イチ"]) {
    const a = clone(b);
    a.texts.close[1] = { text: `この足 ${w}`, em: true };
    fails(a, new RegExp(`言い切りの語「${w}」`), w);
  }
  const z = clone(b);
  z.youtube.description += "\nz=2.1";
  fails(z, /z を出している/, "z");
});

t("画面の文に bundle に無い数を落とす（数字の不一致）", () => {
  const b = load("motor_gap");
  const a = clone(b);
  a.texts.hook[2] = { text: "8走中7回 1位", em: true };
  fails(a, /画面の文の数「8」/, "走数の食い違い");
  const c = clone(b);
  c.texts.hook[0] = "2連率 35% のモーターが";
  fails(c, /画面の文の数「35」/, "2連率の食い違い");
  const up = load("motor_up");
  const d = clone(up);
  d.texts.hook[1] = "後半は 4走中2走で";
  assert.deepEqual(
    check(d),
    [],
    "2 は順位・コースの範囲（1〜6）なので数の検査では止めない（限界）",
  );
});

t("2連率の位置・前半後半の平均・6艇の数の食い違いを落とす", () => {
  const g = load("motor_gap");
  const a = clone(g);
  a.motor_2rate.rank_from_bottom = 12;
  fails(a, /rank_from_bottom（12）が all から求めた 13/, "下から何番目");
  const a2 = clone(g);
  a2.motor_2rate.value = 29.5;
  fails(a2, /value（29.5）が all に無い/, "2連率の値");
  const a3 = clone(g);
  a3.motor_2rate.n = 51;
  fails(a3, /n（51）が all の数（52）と違う/, "機の数");
  const u = load("motor_up");
  const b = clone(u);
  b.halves.late.avg = 1.5;
  fails(b, /halves.late.avg（1.5）が runs から求めた 1.25/, "後半の平均");
  const b2 = clone(u);
  b2.halves.early.courses = [2, 3, 4];
  fails(b2, /halves.early.courses/, "前半のコース");
  const b3 = clone(u);
  b3.halves.late.courses = [6, 1, 2];
  fails(b3, /halves の走数/, "走数の合計");
  const f = clone(load("final_six"));
  f.six.pop();
  fails(f, /six が6艇でない/, "6艇");
});

t("走の値の範囲と必須の欄を落とす", () => {
  const g = load("motor_gap");
  const a = clone(g);
  a.runs[0].rank = 7;
  fails(a, /runs\[0\].rank が1〜6でない/, "順位");
  const b = clone(g);
  b.runs[1].course = 0;
  fails(b, /runs\[1\].course/, "コース");
  const c = clone(g);
  c.runs[2].time = 67.2;
  fails(c, /runs\[2\].time/, "展示タイム");
  const d = clone(g);
  delete d.youtube;
  fails(d, /youtube.title が無い/, "題");
  const e = clone(g);
  e.variant = "motor_down";
  fails(e, /variant が/, "型");
  const f = clone(g);
  f.format = "full_picture";
  fails(f, /format が setsu_kiryoku_short でない/, "format");
});

t("長すぎる文は 36px で収まらないとして落とす", () => {
  const g = clone(load("motor_gap"));
  g.texts.hook[0] =
    "2連率 29% のモーターが 展示タイム 7走中7回 1位 1〜6コース どこでも";
  fails(g, /収まらない/, "長い文");
});

t("2連率の札は x60〜900 に収まる（端の機でも）", () => {
  const g = load("motor_gap");
  for (const rank of [1, g.motor_2rate.n]) {
    const b = clone(g);
    const sorted = [...b.motor_2rate.all].sort((x, y) => x - y);
    b.motor_2rate.value = sorted[rank - 1];
    b.motor_2rate.rank_from_bottom =
      1 + sorted.filter((x) => x < b.motor_2rate.value).length;
    const L = barsLayout(b);
    assert.ok(
      L.labelX >= LEFT - 0.5 && L.labelX + L.labelW <= RIGHT + 0.5,
      `札 x${L.labelX}〜${L.labelX + L.labelW}`,
    );
  }
});

t("border の3人・順位・得点率・要る着の食い違いを落とす", () => {
  const b = load("border");
  const a = clone(b);
  a.racers.pop();
  fails(a, /racers が3人でない/, "3人");
  const c = clone(b);
  c.racers[0].rank = 18;
  fails(c, /racers\[0\].rank（18）が 18 位より下でない/, "ボーダー内の順位");
  const d = clone(b);
  d.racers[1].rate = 6.0;
  fails(d, /racers\[1\].rate（6）が線 6.00 より下でない/, "線以上の得点率");
  const e = clone(b);
  e.racers[2].need = "優勝";
  fails(e, /racers\[2\].need/, "要る着の形");
  const g = clone(b);
  g.racers[2].race = "13R";
  fails(g, /racers\[2\].race/, "R");
  const h = clone(b);
  h.texts.hook[2] = { text: "得点率 6.20", em: true };
  fails(h, /画面の文の数「6.20」/, "線の得点率の食い違い");
  const i = clone(b);
  [i.racers[0], i.racers[1]] = [i.racers[1], i.racers[0]];
  fails(i, /順位の順でない/, "並び");
});

t(
  "/code-review の再現: 全角の数・空白入りの言い切り・要素の形・締めの末尾・画面と同じ書き方の数",
  () => {
    const g = load("motor_gap");
    const a = clone(g);
    a.texts.hook[2] = { text: "８走中７回 1位", em: true };
    fails(a, /画面の文の数「8」/, "全角の数");
    const c = clone(g);
    c.youtube.title = "今節は 節 イチ？";
    fails(c, /言い切りの語「節イチ」/, "空白入りの言い切り");
    const d = clone(g);
    d.texts.hook[1] = null;
    fails(d, /texts.hook\[1\] が文字列か/, "null の要素");
    const e = clone(g);
    e.texts.close = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    fails(e, /y1400 を越える: 節の機力は龍神レーダーで/, "締めの末尾の位置");
    const u = clone(load("motor_up"));
    u.texts.close[0] = "コースの平均 3.3 と 3.3";
    assert.deepEqual(check(u), [], "画面（Halves）と同じ 3.3 の形は通る");
    const b = clone(load("border"));
    b.texts.hook[2] = { text: "得点率 6.0", em: true };
    assert.deepEqual(check(b), [], "得点率 6.0 の形も通る");
  },
);

t("final_six の札は走が多くても重ならず x920 まで（9走まで）", () => {
  for (const n of [6, 7, 8, 9]) {
    const pitch = sixPitch(n);
    const w = sixChipW(pitch);
    assert.ok(pitch - w >= 8, `${n}走で札が重なる`);
    assert.ok(SIX.chipX + (n - 1) * pitch + w <= 920, `${n}走で x920 を越える`);
    assert.ok(Math.min(48, w - 6) >= 36, `${n}走で札の字が36px未満`);
  }
  const f = clone(load("final_six"));
  const extra = f.six[0].runs[0];
  f.six[0].runs = Array.from({ length: 10 }, () => ({ ...extra }));
  fails(f, /走数（10）が多く/, "10走");
});

t(
  "リポジトリの禁止語（数える・似た・ふつう・いつも）を説明欄・画面で落とす（Codex P1、#2076）",
  () => {
    const g = load("motor_gap");
    const a = clone(g);
    a.youtube.description = a.youtube.description.replace(
      "上の順位にそろえる",
      "上位に数える",
    );
    fails(a, /禁止語「数え」/, "説明欄の「数える」");
    const c = clone(g);
    c.texts.close[2] = "いつもの展示とは別物？";
    fails(c, /禁止語「いつも」/, "画面の「いつも」");
  },
);

t("日の札: 月をまたぐ節は「〜」にしない", () => {
  const d = (...xs) => xs.map((x) => ({ day: `${x}日` }));
  assert.equal(daysLabel(d(27, 28)), "27・28日");
  assert.equal(daysLabel(d(29, 30, 30, 31)), "29〜31日");
  assert.equal(daysLabel(d(30, 31, 1)), "30・31・1日");
});

t("平均の順位の書き方", () => {
  assert.equal(fmtAvg(3), "3.0");
  assert.equal(fmtAvg(1.25), "1.25");
  assert.equal(fmtAvg(2 + 1 / 6), "2.17");
});

console.log(`verify-setsu-kiryoku: ${n} 件すべて通過`);
