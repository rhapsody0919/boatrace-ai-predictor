/**
 * verify-setsu-kiryoku.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-setsu-kiryoku.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import {
  tagText,
  heroRunsPitch,
  heroChipFont,
  MIN_FONT,
  CX,
  CENTER_MAX_W,
  rankLabel,
  daysLabel,
  fmtAvg,
  finalGapTexts,
} from "../../../sns-video-studio/remotion/src/setsuKiryoku/model.js";

let loadRaw, load, check, clone, fails, t;

function scene1() {
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
    assert.equal(tagText(f), "11/1（日）尼崎 今日の優勝戦");
    assert.equal(tagText({ ...f, when: "eve" }), "11/1（日）尼崎 優勝戦の前夜");
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
}

function scene2() {
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
}

function scene3() {
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
}

function scene4() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（loadRaw・load・check・clone・fails・t） */
export function runSetsuKiryokuScenes1(env) {
  ({ loadRaw, load, check, clone, fails, t } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
