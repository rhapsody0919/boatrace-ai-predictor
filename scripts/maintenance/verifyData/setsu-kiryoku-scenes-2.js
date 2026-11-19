/**
 * verify-setsu-kiryoku.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-setsu-kiryoku.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import {
  hookLayout,
  borderNameLayout,
  deadlineText,
  screenTexts,
  normalizeBundle,
} from "../../../sns-video-studio/remotion/src/setsuKiryoku/model.js";

let loadRaw, load, check, clone, fails, t;

/** 前夜の final_gap に締切を入れた束（hq が eve_race_deadlines から入れる形。題・説明欄も hq が書く） */
const withDeadline = (race = "11R", time = "15:45") => {
  const f = clone(loadRaw("final_gap"));
  f.when = "eve";
  f.date = "2026-10-31";
  f.final_deadline = { race, time };
  f.youtube.title = f.youtube.title.replace(
    "優勝戦に",
    `優勝戦に 明日${race} ${time}締切予定`,
  );
  f.youtube.description = f.youtube.description.replace(
    "尼崎の優勝戦に乗る",
    `尼崎の優勝戦（明日 ${race}、締切予定 ${time}）に乗る`,
  );
  return f;
};

function scene1() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（loadRaw・load・check・clone・fails・t） */
export function runSetsuKiryokuScenes2(env) {
  ({ loadRaw, load, check, clone, fails, t } = env);
  scene1();
}

function scene2() {
  t(
    "final_gap の日付（hq 846f0e8）: today は date＝final_date、eve は final_date が date の翌日。合わなければ止める",
    () => {
      const f = loadRaw("final_gap");
      assert.deepEqual(
        [f.date, f.final_date, f.when],
        ["2026-11-01", "2026-11-01", "today"],
      );
      assert.deepEqual(check(f), []);
      // 前夜の版（hq の見本と同じ組）は通る。月末をまたぐ翌日も数える
      assert.deepEqual(
        check({ ...clone(f), date: "2026-10-31", when: "eve" }),
        [],
      );
      assert.deepEqual(
        check({
          ...clone(f),
          date: "2026-11-30",
          final_date: "2026-12-01",
          when: "eve",
        }),
        [],
      );
      fails(
        { ...clone(f), date: "2026-10-31" },
        /when=today なのに date（2026-10-31）と final_date（2026-11-01）が違う/,
        "today の日の食い違い",
      );
      fails(
        { ...clone(f), when: "eve" },
        /when=eve なのに final_date（2026-11-01）が date（2026-11-01）の翌日でない/,
        "eve の日の食い違い",
      );
      const g = clone(f);
      delete g.final_date;
      fails(
        g,
        /final_date（優勝戦の日）が YYYY-MM-DD でない/,
        "final_date が無い",
      );
    },
  );
  t("final_gap の締切: 無ければ出さない（今どおり）", () => {
    const f = load("final_gap");
    assert.equal(f.final_deadline, undefined);
    assert.equal(deadlineText(f), null);
    assert.deepEqual(check({ ...clone(f), final_deadline: null }), []);
  });
  t("final_gap の締切: あれば画面に出し、題・説明欄に入っていれば通る（12Rとは限らない）", () => {
    const f = withDeadline("11R", "15:45");
    assert.deepEqual(check(f), []);
    assert.equal(deadlineText(f), "明日 11R 締切予定 15:45", "前夜は「明日」を付ける");
    assert.ok(screenTexts(normalizeBundle(f)).includes("明日 11R 締切予定 15:45"));
    assert.equal(
      deadlineText({ ...clone(f), when: "today", date: f.final_date }),
      "11R 締切予定 15:45",
    );
    // 全角のコロン・英数で書いた題・説明欄も通る
    const z = clone(f);
    z.youtube.title = z.youtube.title.replace("15:45", "１５：４５");
    z.youtube.description = z.youtube.description.replace("11R", "１１Ｒ");
    assert.deepEqual(check(z), []);
    assert.deepEqual(check(withDeadline("12R", "16:30")), []);
  });
  t("final_gap の締切: 題・説明欄に無い・形の誤り・他の型は落とす", () => {
    const f = withDeadline();
    fails(
      { ...clone(f), youtube: { ...f.youtube, title: loadRaw("final_gap").youtube.title } },
      /youtube.title に締切の時刻 15:45 が無い/,
      "題に時刻が無い",
    );
    fails(
      {
        ...clone(f),
        youtube: { ...f.youtube, description: f.youtube.description.replace("明日 11R、", "") },
      },
      /youtube.description に締切（11R 15:45）が無い/,
      "説明欄に R が無い",
    );
    fails({ ...clone(f), final_deadline: { race: "13R", time: "15:45" } }, /final_deadline.race/, "13R");
    // "1R" は "11R" に、"5:45" は "15:45" に当たらない
    fails({ ...clone(f), final_deadline: { race: "1R", time: "15:45" } }, /youtube.description に締切（1R 15:45）が無い/, "1R の部分一致");
    fails({ ...clone(f), final_deadline: { race: "11R", time: "05:45" } }, /youtube.title に締切の時刻 05:45 が無い/, "時刻の部分一致");
    fails({ ...clone(f), final_deadline: { race: "11R", time: "3:45" } }, /final_deadline.time/, "H:MM");
    fails({ ...clone(f), final_deadline: "15:45" }, /final_deadline が \{ race, time \} でない/, "文字列");
    const m = clone(load("motor_gap"));
    m.final_deadline = { race: "12R", time: "16:30" };
    fails(m, /final_deadline は final_gap の型だけ/, "motor_gap の締切");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（loadRaw・load・check・clone・fails・t） */
export function runSetsuKiryokuScenes3(env) {
  ({ loadRaw, load, check, clone, fails, t } = env);
  scene2();
}
