/**
 * verify-sns-full-picture.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-full-picture.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFullPicture } from "../../sns/push-full-picture.js";
import { youtubeTagsOf } from "../../../api/_lib/youtubeQueueAdapter.js";

let first, all, riskRules, VIDEO, bundle, SHORTS, files, bundleV2, saved, store, push;

function scene1() {
  test("完全版のタグ（youtube_full.tags、hq 契約 10/24 C1）: 完全版の下書きの hashtags に入り、承認の snapshot から YouTube の snippet.tags になる。X・Shorts には付けない", async () => {
    const base = bundleV2();
    // bundle.mjs と同じく、説明文の末尾にタグと同じハッシュタグ行がある
    const description = `${base.youtube_full.description}\n#ボートレース #龍神ソナー #思考アシスト`;
    const result = await push({
      ...base,
      youtube_full: {
        ...base.youtube_full,
        description,
        tags: ["ボートレース", "龍神ソナー", "思考アシスト", "龍神ソナー", ""],
      },
    });
    assert.equal(result.reasons, undefined);
    const job = (id) =>
      first(
        "SELECT j.snapshot_text, d.hashtags FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id WHERE j.id=$1",
        [id],
      );
    const full = await job(result.channels.youtube.job_id);
    assert.deepEqual(
      full.hashtags,
      ["#ボートレース", "#龍神ソナー", "#思考アシスト"],
      "重複と空は除く",
    );
    assert.deepEqual(youtubeTagsOf(JSON.parse(full.snapshot_text)), [
      "ボートレース",
      "龍神ソナー",
      "思考アシスト",
    ]);
    // 送る文（承認の snapshot の text）は bundle の説明文と同じ。末尾にタグの行が重ならない（代わりの審査 P2-1）
    const text = JSON.parse(full.snapshot_text).text;
    assert.equal(
      text.replace(
        /\n\n#ボートレース #龍神ソナー #思考アシスト$/,
        "\n#ボートレース #龍神ソナー #思考アシスト",
      ),
      description,
      "送る文は説明文と同じ（ハッシュタグ行の前の空行だけ違ってよい）",
    );
    assert.equal(
      text.match(/龍神ソナー/g).length,
      description.match(/龍神ソナー/g).length,
      "タグの語が増えない",
    );
    for (const ch of ["x", "shorts"])
      assert.deepEqual(
        (await job(result.channels[ch].job_id)).hashtags,
        [],
        `${ch} にタグは付けない`,
      );
  });
}

function scene2() {
  test("bundle の版2の検査: 置き場所がちょうど1つ・題名が完全版と別・Shorts の機械の検査・shorts.mp4・版の値", async () => {
    const reasonsOf = (b) => checkFullPicture(b, riskRules).join();
    assert.equal(reasonsOf(bundleV2()), "");
    assert.match(
      reasonsOf(
        bundleV2({ youtube_shorts: { title: "a", description: "URL なし" } }),
      ),
      /ちょうど1つ/,
    );
    assert.match(
      reasonsOf(
        bundleV2({
          youtube_shorts: { title: "a", description: "{full_url} {full_url}" },
        }),
      ),
      /ちょうど1つ/,
    );
    assert.match(
      reasonsOf(
        bundleV2({
          youtube_shorts: {
            title: "若松12R、逃げ一本でいい？",
            description: "{full_url}",
          },
        }),
      ),
      /youtube_full.title と同じ/,
    );
    assert.match(
      reasonsOf(
        bundleV2({
          youtube_shorts: {
            title: "a",
            description: "{full_url}" + "あ".repeat(4980),
          },
        }),
      ),
      /5000字/,
    );
    assert.match(
      reasonsOf(bundleV2({ qa: { machine: { verify: true }, bannedWords: [] } })),
      /shorts_vertical/,
    );
    assert.match(
      reasonsOf(bundle({ bundle_version: 3 })),
      /bundle_version が不正/,
    );
    // 版1は youtube_shorts を見ない（今の bundle の shorts の欄があっても2件のまま）
    assert.equal(reasonsOf(bundle()), "");
    const missing = await push(bundleV2(), {}, null);
    assert.match(missing.reasons.join(), /shorts.mp4 が無い/);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  });
  test("bundle の版2: 締切の50分前を過ぎて届いたら Shorts だけ作らず、Slack に書く。版には shorts.mp4 も入る", async () => {
    // 版の比べは、生きた item が無いうちに --dry-run で見る（入れた後は同じ締切の重複として拒否する、BOA-1201）
    const a = await push(bundleV2(), { dryRun: true });
    const b = await push(
      bundleV2(),
      { dryRun: true },
      new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 7]),
    );
    assert.notEqual(a.revision, undefined);
    assert.notEqual(a.revision, b.revision);
    const late = await push(bundleV2(), {
      now: new Date("2037-10-18T19:47:00+09:00"),
    });
    assert.equal(late.reasons, undefined);
    assert.equal(late.shortsLate, true);
    assert.deepEqual(Object.keys(late.channels), ["x", "youtube"]);
    assert.match(late.notes[0], /50分前を過ぎて届いたので作らなかった/);
  });
}

function scene3() {
  test("bundle の版2: 完全版の自動の承認に失敗したら、Shorts も自動では承認せず個別承認に回す", async () => {
    store.failApprove = (a) =>
      a.p_snapshot.youtube_title === "若松12R、逃げ一本でいい？";
    try {
      const result = await push(bundleV2());
      assert.match(result.channels.youtube.error, /approve_failed/);
      assert.match(
        result.channels.shorts.error,
        /完全版が自動で承認されなかった/,
      );
      assert.match(result.notes[0], /Shorts は個別承認では送れない/);
      assert.ok(result.channels.x.send_at);
    } finally {
      store.failApprove = false;
    }
    const items = await all(
      "SELECT channel, variant, state FROM sns_auto_send_items ORDER BY channel, variant",
    );
    assert.deepEqual(
      items.map((i) => i.state),
      ["notified", "manual", "manual"],
    );
  });
  test("bundle の版2: Shorts の item を作れなくても（172 が未適用等）、X と完全版は承認して送る。Shorts は作らなかったと Slack に書く", async () => {
    store.failInsertItem = (row) => row.variant === "shorts";
    try {
      const result = await push(bundleV2());
      assert.equal(result.reasons, undefined);
      assert.ok(result.channels.x.send_at);
      assert.ok(result.channels.youtube.send_at);
      assert.equal(result.channels.shorts, undefined);
      assert.match(result.shortsError, /item_insert_failed/);
      assert.match(result.notes[0], /Shorts）: 下書き・item を作れなかった/);
    } finally {
      store.failInsertItem = null;
    }
    assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 2);
  });
  test("版1の bundle の版（revision）は、Shorts 対応の前と同じ式（bundle・X の動画・完全版の動画の順の sha256）", async () => {
    const { createHash } = await import("node:crypto");
    const b = bundle();
    const expected = createHash("sha256")
      .update(JSON.stringify(b))
      .update(VIDEO)
      .update(VIDEO)
      .digest("hex")
      .slice(0, 32);
    assert.equal((await push(b, { dryRun: true })).revision, expected);
  });
  test("完全版の URL の置き場所は Shorts の説明文だけ。X の本文・完全版に入っていたら受け取らない", async () => {
    const reasonsOf = (b) => checkFullPicture(b, riskRules).join();
    assert.match(
      reasonsOf(
        bundleV2({
          youtube_full: { title: "完全版", description: "続きは {full_url}" },
        }),
      ),
      /youtube_full.description に \{full_url\} がある/,
    );
    assert.match(
      reasonsOf(bundle({ x_text: bundle().x_text + " {full_url}" })),
      /x_text に \{full_url\} がある/,
    );
  });
  test("x_text の検査は1回だけ（{full_url} の欄のループに入れない）。x_text が無い bundle でも例外にせず理由を返す", async () => {
    const reasons = checkFullPicture(
      bundle({
        x_text: "https://www.boat-ai.jp/race/2037-10-18-01-01?tab=sonar",
      }),
      riskRules,
    );
    assert.equal(reasons.filter((r) => /このレースの URL/.test(r)).length, 1);
    const noText = checkFullPicture(bundle({ x_text: undefined }), riskRules);
    assert.deepEqual(
      noText.filter((r) => /x_text/.test(r)),
      ["x_text が無い・長すぎる"],
    );
  });
}

function scene4() {
  test("BOA-1167: channels に x が無い束は x_text・full-x.mp4 を受けず、X の下書き・item・job・日の枠の確認を作らない。完全版→Shorts の時刻と親は変えない", async () => {
    const b = bundleV2({ channels: ["youtube", "shorts"], x_text: undefined });
    const f = files(b);
    delete f["/f/full-x.mp4"];
    const asked = [];
    store.xSlotRoom = async (kind, need) => {
      asked.push([kind, need]);
      return { ok: true };
    };
    const savedBefore = saved.length;
    let result;
    try {
      result = await push(b, {
        readBytes: async (p) => {
          if (!f[p]) throw new Error("no file");
          return f[p];
        },
      });
    } finally {
      delete store.xSlotRoom;
    }
    assert.equal(result.reasons, undefined);
    assert.deepEqual(asked, []);
    assert.equal(result.xSlot, null);
    assert.deepEqual(Object.keys(result.channels), ["youtube", "shorts"]);
    assert.deepEqual(
      (await all("SELECT DISTINCT platform FROM sns_drafts")).map(
        (r) => r.platform,
      ),
      ["youtube"],
    );
    assert.deepEqual(
      (
        await all(
          "SELECT channel, variant FROM sns_auto_send_items ORDER BY channel, variant",
        )
      ).map((i) => [i.channel, i.variant]),
      [
        ["youtube", "main"],
        ["youtube", "shorts"],
      ],
    );
    const jobs = await all(
      "SELECT id, parent_job_id, scheduled_at FROM sns_x_send_jobs ORDER BY scheduled_at",
    );
    assert.equal(jobs.length, 2);
    // 完全版は締切の60分前（19:36）の4分後、Shorts はさらに4分後で完全版を親に持つ（X があるときと同じ並び）
    assert.deepEqual(
      jobs.map((j) => j.scheduled_at.toISOString()),
      ["2037-10-18T10:40:00.000Z", "2037-10-18T10:44:00.000Z"],
    );
    assert.equal(jobs[1].parent_job_id, jobs[0].id);
    // full-x.mp4 は上げない
    assert.ok(
      saved.slice(savedBefore).every(([p]) => !p.endsWith("/full-x.mp4")),
    );
    assert.match(result.notes[0], /^x: 束の channels に無いので作らない$/m);
    // 版（revision）は bundle・完全版・Shorts の動画の順
    const { createHash } = await import("node:crypto");
    assert.equal(
      result.revision,
      createHash("sha256")
        .update(JSON.stringify(b))
        .update(VIDEO)
        .update(SHORTS)
        .digest("hex")
        .slice(0, 32),
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・riskRules・VIDEO・bundle・SHORTS・files・bundleV2・saved・store・push） */
export function runSnsFullPictureScenes2(env) {
  ({ first, all, riskRules, VIDEO, bundle, SHORTS, files, bundleV2, saved, store, push } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
