/**
 * verify-sns-setsu-kiryoku-short.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-short.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dryRunClock,
  finalDeadlineMismatch,
  eveDeadlineMismatch,
  raceNumberOf,
  isFinalStage,
  resultLine,
  createRestStore,
} from "../../sns/push-setsu-kiryoku-short.js";
import { push, store, counts, NOTHING, saved } from "./sns-setsu-kiryoku-short-scenes-1.js";

let DAY, NEXT, at, PUSHED_AT, bundle, sampleOf;

function skst5Scene1() {
  test("dry-run の時計: date が今日なら今、見本の束（今日でない）はその日の送る時刻（send_time、無ければ 21:30）の2分前", () => {
    assert.equal(dryRunClock(bundle(), PUSHED_AT), null);
    assert.equal(
      dryRunClock(bundle(), at("12:00:00", NEXT)).toISOString(),
      at("21:28:00").toISOString(),
    );
    assert.equal(
      dryRunClock(
        bundle({ send_time: "20:00" }),
        at("12:00:00", NEXT),
      ).toISOString(),
      at("19:58:00").toISOString(),
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（DAY・NEXT・at・PUSHED_AT・bundle・sampleOf） */
export function runSnsSetsuKiryokuShortScenes9(env) {
  ({ DAY, NEXT, at, PUSHED_AT, bundle, sampleOf } = env);
  skst5Scene1();
}

function skst5Scene2() {
  test("当日の final_gap の締切は DB の優勝戦と同じ R・時刻でないと止める（BOA-1282）", () => {
    const final = { race_id: "2026-11-04-19-11", start_time: "22:20:00" };
    assert.equal(finalDeadlineMismatch(undefined, final), null, "締切が無ければ今どおり");
    assert.equal(finalDeadlineMismatch(null, final), null);
    assert.equal(finalDeadlineMismatch({ race: "11R", time: "22:20" }, final), null);
    assert.match(
      finalDeadlineMismatch({ race: "12R", time: "22:20" }, final),
      /DB の優勝戦（11R 22:20）と違う/,
      "優勝戦は12Rとは限らない（下関 2026-11-04 は11R）",
    );
    assert.match(finalDeadlineMismatch({ race: "11R", time: "22:25" }, final), /と違う/);
    assert.match(
      finalDeadlineMismatch({ race: "11R", time: "22:20" }, { ...final, start_time: null }),
      /締切なし/,
    );
  });
  test("前夜の final_gap の締切は前夜の表の優勝戦の行と同じでないと止める（BOA-1282）", () => {
    const finals = [{ race_id: "2026-11-04-19-11", deadline: "22:20:00" }];
    assert.equal(eveDeadlineMismatch(undefined, finals), null, "締切が無ければ今どおり");
    assert.equal(eveDeadlineMismatch({ race: "11R", time: "22:20" }, finals), null);
    assert.match(eveDeadlineMismatch({ race: "12R", time: "22:45" }, finals), /前夜の表の優勝戦（11R 22:20）と違う/);
    assert.match(eveDeadlineMismatch({ race: "11R", time: "22:20" }, []), /優勝戦の行（is_final）が無い/);
    // 男女W優勝戦はどちらでも通る
    const w = [...finals, { race_id: "2026-11-04-19-12", deadline: "22:45:00" }];
    assert.equal(eveDeadlineMismatch({ race: "12R", time: "22:45" }, w), null);
  });
  test("締切の R で優勝戦を選ぶ（男女W優勝戦で先頭の1件と比べない、Codex P1）", () => {
    assert.equal(raceNumberOf({ race: "11R", time: "15:45" }), 11);
    assert.equal(raceNumberOf(undefined), null);
    for (const s of ["優勝戦", "男子優勝戦", "女子優勝戦"]) assert.equal(isFinalStage(s), true, s);
    for (const s of ["準優勝戦", "選抜戦Ａ", null]) assert.equal(isFinalStage(s), false, String(s));
  });
  test("当日の締切: 束の R の優勝戦と時刻が合えば通り、違う R・時刻なら止める（push の通し）", async () => {
    const withDl = (race, time) => {
      const b = bundle();
      return {
        ...b,
        final_deadline: { race, time },
        youtube: {
          ...b.youtube,
          title: `${b.youtube.title.replace(" #", ` ${race} ${time}締切予定 #`)}`,
          description: b.youtube.description.replace("\n", `\n${race} 締切予定 ${time}\n`),
        },
      };
    };
    const ok = await push(withDl("12R", "16:40"), { dryRun: true });
    assert.ok(!(ok.reasons ?? []).some((x) => /final_deadline|優勝戦が DB に無い/.test(x)), JSON.stringify(ok.reasons));
    const wrongTime = await push(withDl("12R", "16:45"), { dryRun: true });
    assert.ok((wrongTime.reasons ?? []).some((x) => /DB の優勝戦（12R 16:40）と違う/.test(x)), JSON.stringify(wrongTime.reasons));
    const wrongRace = await push(withDl("11R", "16:40"), { dryRun: true });
    assert.ok((wrongRace.reasons ?? []).some((x) => /優勝戦が DB に無い/.test(x)), JSON.stringify(wrongRace.reasons));
  });
  test("border の締切: 3人すべてを races と照合し、不一致・行なし・null・読取失敗で拒否する（BOA-1342）", async () => {
    const b = { ...await sampleOf("border"), date: DAY, send_time: "08:00", source_observed_at: `${DAY}T07:55:00+09:00` };
    const rows = await store.raceStartTimes(DAY, "13", [11, 10, 6]);
    const options = { now: at("07:58:00"), dryRun: true };
    const ok = await push(b, { ...options, store: { ...store, raceStartTimes: async (...args) => {
      assert.deepEqual(args, [DAY, "13", [11, 10, 6]]);
      return rows;
    } } });
    assert.equal(ok.reasons, undefined, JSON.stringify(ok.reasons));
    const { borderDeadlineMismatch } = await import("../../sns/push-setsu-kiryoku-short.js");

    const badRows = [
      [rows.map((r, i) => i === 2 ? { ...r, start_time: "13:05:00" } : r), ["6R", "12:59", "13:05"]],
      [rows.filter((_, i) => i !== 1), ["10R", "15:15", "行なし"]],
      [rows.map((r, i) => i === 1 ? { ...r, start_time: null } : r), ["10R", "15:15", "締切なし"]],
      [rows.map((r, i) => i === 0 ? { ...r, start_time: "15:55:00" } : r), ["11R", "15:50", "15:55"]],
    ];
    for (const [changed, words] of badRows) {
      const result = await push(b, { ...options, store: { ...store, raceStartTimes: async () => changed } });
      assert.equal(resultLine(result).code, 1);
      const reason = borderDeadlineMismatch(b.racers, changed);
      for (const word of words) {
        assert.ok(reason.includes(word), reason);
        assert.ok(result.reasons.some((r) => r.includes(word)), JSON.stringify(result.reasons));
      }
    }
    assert.equal(borderDeadlineMismatch(b.racers, [...rows].reverse()), null);
    const broken = await push(b, { ...options, store: { ...store, raceStartTimes: async () => { throw new Error("read failed"); } } });
    assert.equal(resultLine(broken).code, 1);
    assert.match(broken.reasons.join(" "), /read failed/);
    const rejected = await push(b, { ...options, dryRun: false, store: { ...store, raceStartTimes: async () => badRows[0][0] } });
    assert.equal(resultLine(rejected).code, 1);
    assert.match(rejected.notes[0], /6R.*12:59.*13:05/);
    assert.deepEqual(await counts(), NOTHING);
    assert.deepEqual(saved, []);
  });
}

function skst5Scene3() {
  test("raceStartTimes: 指定した日・会場・R だけを REST で読み、HTTP 失敗を投げる", async () => {
    const rows = await store.raceStartTimes(DAY, "13", [11, 10, 6]);
    const requests = [];
    const rest = createRestStore({ url: "https://db.invalid", key: "test-only", fetchImpl: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify(rows));
    } });
    assert.deepEqual(await rest.raceStartTimes(DAY, "13", [11, 10, 6]), rows);
    assert.equal(requests[0], `https://db.invalid/rest/v1/races?race_id=in.(${DAY}-13-11,${DAY}-13-10,${DAY}-13-06)&select=race_id,start_time`);
    const failed = createRestStore({ url: "https://db.invalid", key: "test-only", fetchImpl: async () => new Response("read failed", { status: 503 }) });
    await assert.rejects(failed.raceStartTimes(DAY, "13", [11, 10, 6]), /HTTP 503.*read failed/);
    const offline = createRestStore({ url: "https://db.invalid", key: "test-only", fetchImpl: async () => { throw new Error("offline"); } });
    await assert.rejects(offline.raceStartTimes(DAY, "13", [11, 10, 6]), /offline/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（DAY・NEXT・at・PUSHED_AT・bundle・sampleOf） */
export function runSnsSetsuKiryokuShortScenes10(env) {
  ({ DAY, NEXT, at, PUSHED_AT, bundle, sampleOf } = env);
  skst5Scene2();
  skst5Scene3();
}
