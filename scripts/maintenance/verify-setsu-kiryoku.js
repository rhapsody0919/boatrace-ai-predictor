/**
 * YouTube Shorts「節の機力」（sns-video-studio/remotion/src/setsuKiryoku/）の型の決まりを確かめる（外部接続なし）。
 * - 見本の bundle（samples/motor_gap・motor_up・final_gap・border）が検査（checkBundle）を通る
 * - 章の尺: motor_gap・motor_up は約15秒（14〜16秒）・4章、final_gap は17秒・5章、border（準優に残れるか）は約15秒・3章
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
  CENTER_MAX_W,
  CX,
  MIN_FONT,
  barsLayout,
  borderNameLayout,
  checkBundle,
  finalGapTexts,
  normalizeBundle,
  closeLayout,
  daysLabel,
  fmtAvg,
  heroChipFont,
  heroRunsPitch,
  hookLayout,
  rankLabel,
  tagText,
  timeline,
} from "../../sns-video-studio/remotion/src/setsuKiryoku/model.js";

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

t("final_gap の見本は尼崎 11/1 の値（龍神 DB の読み取りで照合した値）", () => {
  const f = load("final_gap");
  assert.equal(f.hero.racer, "茅原 悠紀");
  assert.equal(f.hero.class, "A1");
  assert.equal(f.hero.motor, 20);
  assert.equal(f.hero.motor_2rate.value, 26.57);
  assert.equal(f.hero.motor_2rate.rank_from_bottom, 1);
  assert.equal(f.hero.motor_2rate.n, 52);
  assert.deepEqual(
    f.hero.runs.map((r) => `${r.rank}/${r.course}`),
    ["2/5", "2/2", "1/3", "3/6", "1/4", "3/1", "1/4"],
  );
  assert.deepEqual(
    f.six.map((r) => `${r.motor}:${r.rank_in_all}:${r.wins}/${r.runs_n}`),
    [
      "20:52:3/7",
      "1:31:2/7",
      "15:30:2/6",
      "2:27:3/7",
      "37:22:2/7",
      "35:16:2/7",
    ],
  );
  assert.equal(tagText(f), "尼崎 今日の優勝戦");
  assert.equal(tagText({ ...f, when: "eve" }), "尼崎 優勝戦の前夜");
});

t("final_gap: 名前と級が欠けたら止める（オーナー 11/1 の恒久の決まり）", () => {
  const f = load("final_gap");
  const a = clone(f);
  delete a.hero.class;
  fails(a, /hero.class（級）が A1・A2・B1・B2 でない/, "主役の級");
  const b = clone(f);
  b.hero.racer = " ";
  fails(b, /hero.racer（名前）が無い/, "主役の名前");
  const c = clone(f);
  c.six[3].class = "";
  fails(c, /six\[3\].class（級）/, "6人の級");
  const d = clone(f);
  delete d.six[4].racer;
  fails(d, /six\[4\].racer（名前）が無い/, "6人の名前");
  const e = clone(f);
  e.six[2].class = "A3";
  fails(e, /six\[2\].class/, "級の値");
});

t("final_gap: 主役・6人・全機の2連率の食い違いを落とす", () => {
  const f = load("final_gap");
  const a = clone(f);
  a.hero.motor_2rate.rank_from_bottom = 2;
  fails(
    a,
    /hero.motor_2rate.rank_from_bottom（2）が all から求めた 1/,
    "下から何番目",
  );
  const b = clone(f);
  b.six[1].rank_in_all = 30;
  fails(b, /six\[1\].rank_in_all（30）が全機から求めた 31/, "全機の中の順位");
  const c = clone(f);
  c.six[5].motor_2rate = 39.1;
  fails(c, /six\[5\].motor_2rate（39.1）が全機の2連率に無い/, "2連率の値");
  const d = clone(f);
  d.six[0].wins = 2;
  fails(
    d,
    /主役の展示1位（3\/7走）と six の行（2\/7走）が違う/,
    "主役の展示1位",
  );
  const e = clone(f);
  e.hero.motor = 99;
  fails(e, /主役のモーター99が six に無い/, "主役が6人にいない");
  const g = clone(f);
  g.six[2].wins = 7;
  fails(g, /six\[2\].wins（7）が 0〜走数（6）でない/, "1位の回数");
  const h = clone(f);
  h.six[3].motor = 1;
  fails(h, /six のモーターが重なる/, "モーターの重なり");
  const i = clone(f);
  i.when = "前夜";
  fails(i, /when が eve\|today でない/, "札");
});

t(
  "final_gap: 主役の選び（2連率の順位＋展示の平均順位の和が最小）に合わないと止める",
  () => {
    const f = clone(load("final_gap"));
    // 主役の展示を全部6位にすると、和が最小は主役でなく島村 隆幸（2連率の低い順で1＋展示の良い順で3）になる
    f.hero.runs = f.hero.runs.map((r) => ({ ...r, rank: 6 }));
    Object.assign(f.six[0], { wins: 0, avg_rank: 6 });
    fails(f, /主役（モーター20）が選びの式に合わない/, "選びの式");
    const g = clone(load("final_gap"));
    g.six[0].avg_rank = 2.5;
    fails(
      g,
      /主役の展示の平均順位（1.86）と six の avg_rank（2.5）が違う/,
      "主役の平均",
    );
    const h = clone(load("final_gap"));
    for (const r of h.six) delete r.avg_rank;
    // /code-review: 任意だと選びが照合されないまま通る。欠けたら止める
    fails(
      h,
      /six\[0\].avg_rank（展示の平均順位）が1〜6の数でない/,
      "avg_rank が無い",
    );
  },
);

t(
  "/code-review・P0 審査の再現（final_gap）: 位置の言い方・6人の数の取り違え・全部0の2連率・説明欄の集計の時刻",
  () => {
    const f = load("final_gap");
    const a = clone(f);
    // 3番目に下のモーターを主役にして「一番下」の hook のまま（数は 52 だけで数の検査は通る）
    const all = [...a.hero.motor_2rate.all].sort((x, y) => x - y);
    a.hero.motor_2rate.value = all[2];
    a.hero.motor_2rate.rank_from_bottom = 3;
    a.six[0].motor_2rate = all[2];
    a.six[0].rank_in_all = 50;
    fails(a, /hook に2連率の位置「下から3番目」が無い/, "位置の言い方");
    fails(
      a,
      /hook の「一番下」が rank_from_bottom 3 と違う/,
      "一番下の取り違え",
    );
    const b = clone(f);
    b.texts.hook[1] = { text: "尼崎31機で 一番下", em: true };
    fails(b, /画面の文の数「31」/, "6人の順位（31）を機の数に取り違え");
    const c = clone(f);
    c.hero.motor_2rate.all = c.hero.motor_2rate.all.map(() => 0);
    c.hero.motor_2rate.value = 0;
    fails(c, /hero.motor_2rate.all が全部0/, "全部0");
    const d = clone(f);
    d.youtube.description = d.youtube.description.replace(
      "集計: 10/31 12Rまで\n",
      "",
    );
    fails(d, /説明欄に集計の時刻「10\/31 12Rまで」が無い/, "集計の時刻");
  },
);

t("final_gap: 数字の不一致・締め・禁止語・言い切りを落とす", () => {
  const f = load("final_gap");
  const a = clone(f);
  a.texts.hook[1] = { text: "尼崎51機で 一番下", em: true };
  fails(a, /画面の文の数「51」/, "機の数");
  const b = clone(f);
  b.texts.close = b.texts.close.slice(0, 3);
  fails(b, /締めに「コメントで教えて」が無い/, "締め");
  const c = clone(f);
  c.youtube.title = "今節は足が良い #ボートレース";
  fails(c, /言い切りの語「足が良い」/, "言い切り");
  const d = clone(f);
  d.youtube.description += "\n万舟券";
  fails(d, /gambling-incitement/, "禁止表現");
  const e = clone(f);
  e.six[1].racer = "競艇 太郎";
  fails(e, /banned-term-kyoutei/, "画面の選手名の禁止語");
});

t(
  "final_gap: 主役の走の札は 36px 以上で x180〜900 に収まる（10走まで）、名前が長いと止める",
  () => {
    for (const n of [5, 7, 8, 10]) {
      const pitch = heroRunsPitch(n);
      assert.ok(heroChipFont(pitch) >= MIN_FONT, `${n}走で札の字が36px未満`);
      const left = CX - (n * pitch) / 2;
      assert.ok(
        left >= CX - CENTER_MAX_W / 2 &&
          left + n * pitch <= CX + CENTER_MAX_W / 2,
        `${n}走で幅の外`,
      );
    }
    const f = clone(load("final_gap"));
    const r0 = f.hero.runs[0];
    f.hero.runs = Array.from({ length: 11 }, () => ({ ...r0 }));
    f.six[0].runs_n = 11;
    f.six[0].wins = 0;
    f.six[0].avg_rank = 2;
    fails(f, /主役の走数（11）が多く順位の札の字が 36px を下回る/, "11走");
    const g = clone(load("final_gap"));
    g.six[2].racer = "ながいながい なまえのせんしゅ";
    fails(g, /名前が一覧の幅 230px に 36px で収まらない/, "長い名前");
  },
);

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

t("border の同率（tied）: true で「同率20位」、bool でない値で止まる", () => {
  const b = load("border");
  assert.equal(
    b.racers[1].tied,
    true,
    "見本は小池だけ同率（hq の正本、尼崎 10/30）",
  );
  assert.equal(rankLabel(b.racers[1]), "同率20位");
  assert.equal(rankLabel(b.racers[0]), "19位");
  assert.deepEqual(check(b), []);
  const a = clone(b);
  a.racers[1].tied = "yes";
  fails(a, /racers\[1\].tied が true・false か無しでない/, "bool でない tied");
  const c = clone(b);
  c.racers[1].tied = 1;
  fails(c, /racers\[1\].tied/, "数の tied");
  const d = clone(b);
  d.racers[2].rank = 20;
  fails(d, /順位の順でない/, "同率でない同じ順位");
  d.racers[2].tied = true;
  assert.deepEqual(check(d), [], "両方が同率なら同じ順位を許す");
});

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

t(
  "hq の束（final_gap.py の bundle.json、hq 9eb1a0e）をそのまま通す: texts・grade 無し、hero.runs に day",
  () => {
    const raw = loadRaw("final_gap");
    assert.equal(
      raw.texts,
      undefined,
      "見本は hq の束のまま（texts を足していない）",
    );
    assert.equal(raw.grade, undefined);
    assert.equal(raw.hero.runs[0].day, "27日");
    assert.ok(raw.youtube.description.startsWith("集計: 10/31 12Rまで\n"));
    assert.deepEqual(check(raw), []);
    // texts は値から作る（hook の位置の言い方は rank_from_bottom から）
    assert.equal(finalGapTexts(raw).hook[1].text, "尼崎52機で 一番下");
    const r3 = clone(raw);
    r3.hero.motor_2rate.rank_from_bottom = 3;
    assert.equal(finalGapTexts(r3).hook[1].text, "尼崎52機で 下から3番目");
    const bad = clone(raw);
    bad.hero.runs[0].day = "27";
    fails(bad, /hero.runs\[0\].day が「27日」の形でない/, "日の形");
    // 他の型は今までどおり grade が要る
    const g = clone(load("motor_gap"));
    delete g.grade;
    fails(g, /grade が無い/, "motor_gap の grade");
  },
);

t(
  "motor_gap・motor_up・border: 名前の隣に級を出し、欠けたら止める（オーナー 11/1）",
  () => {
    for (const v of ["motor_gap", "motor_up"]) {
      const b = load(v);
      assert.equal(b.class, "A1");
      assert.equal(
        hookLayout(b).sub.text,
        `${b.racer} A1 ・ モーター${b.motor}`,
      );
      const a = clone(b);
      delete a.class;
      fails(a, /^class（級）が A1・A2・B1・B2 でない: undefined/, `${v} の級`);
      const c = clone(b);
      c.class = "SG";
      fails(c, /^class（級）が/, `${v} の級の値`);
    }
    const bd = load("border");
    assert.deepEqual(
      bd.racers.map((r) => r.class),
      ["A1", "A1", "A1"],
    );
    for (const r of bd.racers) {
      const L = borderNameLayout(r);
      assert.ok(
        L.classRight + 10 <= L.rateLeft,
        `${r.racer} の級が得点率に重なる`,
      );
    }
    const a = clone(bd);
    delete a.racers[1].class;
    fails(a, /racers\[1\].class（級）/, "border の級");
    const c = clone(bd);
    c.racers[1].racer = "ながいながい なまえ";
    fails(
      c,
      /racers\[1\] の名前と級（ながいながい なまえ A1）が得点率の欄に重なる/,
      "長い名前と級",
    );
  },
);

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

console.log(`verify-setsu-kiryoku: ${n} 件すべて通過`);
