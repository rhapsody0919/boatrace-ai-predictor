/**
 * YouTube Shorts「節の機力」（sns-video-studio/remotion/src/setsuKiryoku/）の型の決まりを確かめる（外部接続なし）。
 * - 見本の bundle（samples/motor_gap・motor_up・final_gap・border）が検査（checkBundle）を通る
 * - 章の尺: motor_gap・motor_up は約15秒（14〜16秒）・4章、final_gap は17秒・5章、border（準優に残れるか）は約15秒・3章
 * - final_gap の締切（final_deadline、BOA-1282）: 無ければ今どおり出さない、あれば「11R 締切予定 15:45」を画面に出し、題に時刻・説明欄に R と時刻が要る。形の誤りと他の型の締切を落とす
 * - final_gap: 名前と級（欠けたら止める）・主役と6人と全機の2連率の照合・主役の選び・締め。final_six は選べない
 * - border: 3人・順位が cut より下・得点率が線より下・要る着の形・R と号艇を確かめる
 * - 検査が P0 を落とす: 禁止語（risk-rules.json）・言い切りの語・z・画面の文に bundle に無い数・
 *   2連率の「下から何番目」と all の食い違い・前半後半の平均と runs の食い違い・6艇でない・走の値の範囲
 * - 配置の推定: hook・close の文が最小 36px で 720px に収まり y1400 を越えない、2連率の札が x60〜900 に収まる
 * 実際の描画の箱（x≤940・y≤1400）は SetsuKiryoku.jsx が各コマで DOM を測って止める（Remotion の描画のとき）。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import {
  RIGHT,
  LEFT,
  SAFE,
  VARIANTS,
  MIN_FONT,
  barsLayout,
  borderCardRaceText,
  borderCardRaceSize,
  allowedNumbers,
  checkBundle,
  normalizeBundle,
  closeLayout,
  hookLayout,
  tagText,
  tagSize,
  TAG_MAX_W,
  dateLabel,
  timeline,
  deadlineText,
  screenTexts,
} from "../../sns-video-studio/remotion/src/setsuKiryoku/model.js";
import { runSetsuKiryokuScenes1 } from "./verifyData/setsu-kiryoku-scenes-1.js";
import { runSetsuKiryokuScenes2, runSetsuKiryokuScenes3 } from "./verifyData/setsu-kiryoku-scenes-2.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SK = join(ROOT, "sns-video-studio/remotion/src/setsuKiryoku");
const rules = JSON.parse(
  readFileSync(join(ROOT, "sns-video-studio/remotion/risk-rules.json"), "utf8"),
).rules;
/** 見本の束をそのまま読む（hq の束どおり。final_gap は texts を持たない） */
const loadRaw = (v) =>
  JSON.parse(readFileSync(join(SK, "samples", `${v}.json`), "utf8"));
/** 描く前と同じく、texts の無い final_gap は値から作った texts をそろえる */
const load = (v) => normalizeBundle(loadRaw(v));
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

t("札に日付・公式の日目を出す（BOA-1307）", () => {
  const expected = {
    motor_gap: "10/31（土）尼崎 SG 5日目",
    motor_up: "10/31（土）尼崎 SG 5日目",
    border: "10/30（金）尼崎 SG 4日目 予選最終日",
    final_gap: "11/1（日）尼崎 今日の優勝戦",
  };
  for (const v of VARIANTS) {
    const b = load(v);
    assert.equal(tagText(b), expected[v]);
    assert.equal(tagSize(b), 40);
    assert.deepEqual(check(b), []);
    assert.ok(!screenTexts(b).includes(tagText(b)));
  }
  const f = load("final_gap");
  assert.equal(tagText({ ...f, when: "eve" }), "11/1（日）尼崎 優勝戦の前夜");
  assert.ok(!Object.hasOwn(f, "series_day_text"));
  assert.deepEqual(check(f), []);
});

t("日付の形・実在・曜日（UTC）を照合する", () => {
  assert.equal(dateLabel("2026-11-03"), "11/3（火）");
  assert.equal(dateLabel("2026-01-05"), "1/5（月）");
  assert.equal(dateLabel("2024-02-29"), "2/29（木）");
  assert.equal(dateLabel("0004-02-29"), "2/29（日）");
  for (const d of ["2026-11-31", "11/3", "2026-02-29", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-05", null])
    assert.equal(dateLabel(d), null);
  for (const v of VARIANTS)
    for (const date of ["2026-11-31", "11/3"])
      fails({ ...load(v), date }, /date が YYYY-MM-DD の実在する日でない/, `${v} の日付 ${date}`);
});

t("公式の日目の欠落・形の誤りと札の幅超過を落とす", () => {
  for (const v of ["motor_gap", "motor_up", "border"]) {
    const b = load(v);
    for (const series_day_text of [undefined, "3日", "13日目", "1日目"])
      fails({ ...b, series_day_text }, /series_day_text/, `${v} の日目 ${series_day_text}`);
    for (const series_day_text of ["初日", "最終日", "2日目", "9日目", "10日目", "12日目"])
      assert.deepEqual(check({ ...b, series_day_text }), []);
  }
  fails({ ...load("final_gap"), when: "eve", date: "11/3" },
    /date が YYYY-MM-DD の実在する日でない/, "前夜の不正な日付");
  assert.equal(TAG_MAX_W, 792);
  const shrunk = { ...load("border"), grade: "SG あああ" };
  assert.ok(tagSize(shrunk) >= MIN_FONT && tagSize(shrunk) < 40);
  assert.deepEqual(check(shrunk), []);
  const wide = { ...load("border"), grade: "SG 第71回ボートレースダービー 予選の最終日のレース" };
  assert.equal(tagSize(wide), null);
  fails(wide, /札が幅 792px に 36px で収まらない/, "長い札");
});

t("border: 札・冒頭とサムネの締切、題・説明欄を照合する", () => {
  const b = load("border");
  assert.equal(deadlineText(b), "最初の締切 12:59");
  assert.equal(borderCardRaceText(b.racers[0]), "今日 11R 締切15:50 4号艇");
  assert.equal(borderCardRaceText(b.racers[2]), "今日 6R 締切12:59 3号艇");
  assert.ok(screenTexts(b).includes(borderCardRaceText(b.racers[0])));
  assert.deepEqual(check(b), []);
  for (const r of b.racers) assert.ok(borderCardRaceSize(r) >= MIN_FONT);
  for (const num of ["12", "59", "15", "50"]) assert.ok(allowedNumbers(b).has(num));
  assert.ok(screenTexts(b).includes(deadlineText(b)));
  const noRace = clone(b);
  delete noRace.racers[0].race;
  fails(noRace, /racers\[0\].race が「11R」の形でない/, "R の欠落");
  for (const deadline of ["25:00", "9:30", undefined]) {
    const a = clone(b);
    a.racers[1].deadline = deadline;
    fails(a, /racers\[1\].deadline が HH:MM でない/, "締切の形・欠落");
  }
  const title = clone(b);
  title.youtube.title = title.youtube.title.replace("12:59", "");
  fails(title, /youtube.title に締切の時刻 12:59 が無い/, "題の締切");
  const desc = clone(b);
  desc.youtube.description = desc.youtube.description.replace("10R 15:15", "");
  fails(desc, /youtube.description に締切（10R 15:15）が無い/, "説明欄の締切");
  const race = clone(b);
  race.racers[0].race = "1R";
  fails(race, /youtube.description に締切（1R 15:50）が無い/, "1R と11Rを区別");
  const only1R = clone(b);
  only1R.youtube.description = "1R 15:50、10R 15:15、6R 12:59";
  fails(only1R, /youtube.description に締切（11R 15:50）が無い/, "1Rだけで11Rを満たさない");
  const wide = clone(b);
  wide.racers[0].race = "11R".repeat(30);
  fails(wide, /札のレース行が 500px に収まらない/, "札の幅");
  const hook = clone(b);
  hook.racers.forEach((r) => { r.deadline = "12:59".repeat(30); });
  fails(hook, /締切の行が 840px に収まらない/, "hook の締切行の幅");
  const full = clone(b);
  full.youtube.title = full.youtube.title.replace("12:59", "１２：５９");
  full.youtube.description = full.youtube.description.replaceAll(":", "：");
  assert.deepEqual(check(full), []);
  for (const v of ["final_gap", "motor_gap", "motor_up"]) {
    const a = load(v);
    a.racers = [{ deadline: "12:59" }];
    fails(a, /racers\[\].deadline は border の型だけ/, "他の型の締切");
  }
  for (const v of ["motor_gap", "motor_up"])
    assert.equal(deadlineText(load(v)), null);
});

for (const v of VARIANTS) {
  t(`見本 ${v} が検査を通る`, () => {
    const b = load(v);
    assert.equal(b.variant, v);
    assert.deepEqual(check(b), []);
  });
  // final_gap は依頼文 1節の 0〜17秒・5頁（見本 hq final_gap.py の mp4 も 17.0秒）
  const pages = { border: 3, final_gap: 5 }[v] ?? 4;
  t(`${v} の尺と章（${pages}章）`, () => {
    const tl = timeline(v);
    assert.equal(tl.chapters.length, pages);
    if (v === "final_gap")
      assert.equal(tl.total, 17 * 30, `尺 ${tl.total / 30}秒`);
    else
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
  const f = clone(load("final_gap"));
  f.six.pop();
  fails(f, /six が6人でない/, "6人");
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

t(
  "final_six は選べない（オーナー 11/1 取り下げ、final_gap に置き換え）",
  () => {
    assert.ok(!VARIANTS.includes("final_six"));
    assert.ok(!existsSync(join(SK, "samples", "final_six.json")));
    const f = clone(load("final_gap"));
    f.variant = "final_six";
    fails(
      f,
      /variant が motor_gap\|motor_up\|final_gap\|border でない/,
      "final_six",
    );
  },
);

// ---- 後半の場面（verifyData/setsu-kiryoku-scenes-1.js・setsu-kiryoku-scenes-2.js） ----
runSetsuKiryokuScenes1({ loadRaw, load, check, clone, fails, t });
runSetsuKiryokuScenes2({ loadRaw, load, check, clone, fails, t });

t(
  "Root.jsx の SetsuKiryokuShort は defaultProps を置かない（--props に見本の欄が重なり、欠けた級・texts が埋まるのを防ぐ）",
  () => {
    const root = readFileSync(
      join(ROOT, "sns-video-studio/remotion/src/Root.jsx"),
      "utf8",
    );
    const i = root.indexOf('id="SetsuKiryokuShort"');
    assert.ok(i > 0);
    const block = root.slice(i, root.indexOf("/>", i));
    assert.ok(
      !/defaultProps/.test(block),
      "SetsuKiryokuShort に defaultProps がある",
    );
  },
);

// ---- 後半の場面（verifyData/setsu-kiryoku-scenes-2.js） ----
runSetsuKiryokuScenes3({ loadRaw, load, check, clone, fails, t });

console.log(`verify-setsu-kiryoku: ${n} 件すべて通過`);
