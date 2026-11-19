/**
 * verify-prediction-refresh.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-refresh.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { raceIdsOf, createFakeClient } from "./prediction-refresh-fake-client.js";

let mainRefresh, check, show, raceTables, NOW, quiet;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const ids = raceIdsOf(3);
  const existing = ids.flatMap((race_id) =>
    ["standard", "safeBet", "upsetFocus"].map((model_id) => ({
      race_id,
      model_id,
      top_pick: 6, // 再計算後の値（1〜）と区別できる古い値
      is_shadow: false,
      is_hit_win: true,
      payout_win: 500,
      scores: { old: true },
    })),
  );
  const build = (fail = {}) =>
    createFakeClient({
      tables: { ...raceTables(ids), predictions: existing },
      fail,
    });
  // replace は廃止（BOA-628）: 指定すると例外にし、何も書かない
  const replaceFake = build();
  const replaceRun = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: replaceFake,
      writeMode: "replace",
      now: () => NOW,
    }),
  );
  check(
    "replace は廃止（BOA-628）: writeMode='replace' は例外で、predictions に書かない",
    replaceRun.error instanceof Error &&
      /replace/.test(replaceRun.error.message) &&
      replaceFake.calls.every(
        (c) => c.table !== "predictions" || c.op === "select",
      ),
    replaceRun.error?.message,
  );
  // 既定は upsert
  const defaultFake = build();
  const defaultRun = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: defaultFake,
      now: () => NOW,
    }),
  );
  check(
    "既定（writeMode 未指定）は upsert。戻り値は { predictedRaceIds, volatilityUpdated, writeMode: 'upsert' }",
    show(
      defaultFake.calls
        .filter((c) => c.table === "predictions" && c.op !== "select")
        .map((c) => c.op),
    ) === show(["upsert"]) &&
      show(defaultRun.value?.predictedRaceIds) === show(ids) &&
      defaultRun.value?.writeMode === "upsert",
    show(defaultRun.value),
  );
  // upsert: 削除も挿入もしない。1文の upsert（一意制約 race_id,model_id）
  const upsertFake = build();
  const upsertRun = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: upsertFake,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const upsertOps = upsertFake.calls.filter(
    (c) => c.table === "predictions" && c.op !== "select",
  );
  return { ids, build, upsertFake, upsertRun, upsertOps };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ ids, build, upsertFake, upsertRun, upsertOps }) {
  check(
    "upsert: predictions への書き込みは upsert の1回のみ（削除・挿入をしない）で、競合キーは race_id,model_id",
    upsertOps.length === 1 &&
      upsertOps[0].op === "upsert" &&
      upsertOps[0].opts?.onConflict === "race_id,model_id" &&
      !upsertRun.error,
    show(upsertOps.map((c) => [c.op, c.opts])),
  );
  const afterUpsert = upsertFake.state.predictions;
  check(
    "upsert: 行数は増えず（3レース×3モデル=9行のまま）、全て再計算後の値に更新される",
    afterUpsert.length === 9 && afterUpsert.every((p) => p.top_pick !== 6),
    `${afterUpsert.length}行`,
  );
  const sample = afterUpsert[0];
  check(
    "upsert: 行の内容は replace（削除→挿入）と同じ。的中フラグ・払戻・scores は null に戻り、predicted_at は現在時刻、is_shadow は false",
    sample.is_hit_win === null &&
      sample.payout_win === null &&
      sample.scores === null &&
      sample.is_shadow === false &&
      sample.predicted_at === NOW.toISOString(),
    show(sample),
  );
  // upsert で失敗しても、以前の予測が残る（例外にする）
  const upsertBroken = build({ "predictions:upsert": "connection reset" });
  const broken = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: upsertBroken,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  check(
    "upsert: 書き込みに失敗したら例外にし、以前の予測（9行・古い値）は残る（予測が空にならない）",
    broken.error instanceof Error &&
      /predictions書き込みエラー/.test(broken.error.message) &&
      upsertBroken.state.predictions.length === 9 &&
      upsertBroken.state.predictions.every((p) => p.top_pick === 6),
    `${broken.error?.message} / ${upsertBroken.state.predictions.length}行`,
  );
  // races の volatility 更新は、変更のあるレースのみ（WS8(b)）。2回目は、値が同じなら書かない
  const twice = build();
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: twice,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const firstUpdates = twice.calls.filter(
    (c) => c.table === "races" && c.op === "update",
  ).length;
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: twice,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const secondUpdates =
    twice.calls.filter((c) => c.table === "races" && c.op === "update").length -
    firstUpdates;
  check(
    "races の volatility 更新は、1回目は変更のある3レース、値が同じ2回目は0件（変更の無い行は書かない）",
    firstUpdates === 3 && secondUpdates === 0,
    `${firstUpdates}件・${secondUpdates}件`,
  );
}

async function scene3() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  // ---------------------------------------------------------------------------
  // (e2) unified の行: upsert は触らない（廃止した replace は削除していた。BOA-628）
  //      unified は、朝の日次バッチ（generate-unified-predictions.js）が書く model_id='unified'（is_shadow=false）。
  //      replace は is_shadow=false の全モデルを削除するため、再計算のたびに unified が消え、次の GitHub Actions
  //      の実行（morning-init.js の ensureUnifiedPredictions）が「unified が欠けたレースがある」ことを検知して
  //      日全体を再生成している。この再生成の起点は、削除の副作用による（設計上は朝の日次バッチ）。
  // ---------------------------------------------------------------------------
  {
    const ids = raceIdsOf(2);
    const unified = ids.map((race_id) => ({
      race_id,
      model_id: "unified",
      top_pick: 9,
      is_shadow: false,
      feature_contributions: { placeRecommendation: "morning" },
    }));
    const build = () =>
      createFakeClient({
        tables: {
          ...raceTables(ids),
          predictions: unified.map((r) => ({ ...r })),
        },
      });
    const unifiedOf = (fake) =>
      fake.state.predictions.filter((p) => p.model_id === "unified");

    const upsertFake = build();
    await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: ids,
        client: upsertFake,
        writeMode: "upsert",
        now: () => NOW,
      }),
    );
    check(
      "upsert: unified の行は削除も更新もしない（朝の日次バッチの値のまま残る）。standard・safeBet・upsetFocus だけを書く",
      unifiedOf(upsertFake).length === 2 &&
        unifiedOf(upsertFake).every(
          (p) =>
            p.top_pick === 9 &&
            p.feature_contributions?.placeRecommendation === "morning",
        ) &&
        upsertFake.state.predictions.length === 8,
      `${upsertFake.state.predictions.length}行`,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（mainRefresh・check・show・raceTables・NOW・quiet） */
export async function runPredictionRefreshScenes2(env) {
  ({ mainRefresh, check, show, raceTables, NOW, quiet } = env);
  await scene3();
}

async function scene4() {
  // ---------------------------------------------------------------------------
  // (g) 併走の排他: 同じレースを、GitHub と Vercel が同時に再計算する
  //     GitHub が [r1, r2] を削除した直後に、Vercel が [r1] を書く状況を再現する
  // ---------------------------------------------------------------------------
  {
    const ids = raceIdsOf(2);
    const initial = ids.flatMap((race_id) =>
      ["standard", "safeBet", "upsetFocus"].map((model_id) => ({
        race_id,
        model_id,
        top_pick: 6,
        is_shadow: false,
      })),
    );

    const interleave = async (githubMode, vercelMode) => {
      const fake = createFakeClient({
        tables: { ...raceTables(ids), predictions: initial },
      });
      const realFrom = fake.from;
      let injected = false;
      const wrapped = {
        ...fake,
        from: (table) => {
          const builder = realFrom(table);
          if (table !== "predictions") return builder;
          const realDelete = builder.delete;
          builder.delete = () => {
            const b = realDelete();
            const realThen = b.then;
            b.then = (resolve, reject) =>
              realThen.call(
                b,
                (value) => {
                  // GitHub の削除が済んだ直後に、Vercel の再計算（同じレース r1）が書き込む
                  if (!injected) {
                    injected = true;
                    return quiet(() =>
                      mainRefresh({
                        isDryRun: false,
                        specificRaceIds: [ids[0]],
                        client: { ...fake, from: realFrom },
                        writeMode: vercelMode,
                        now: () => NOW,
                      }),
                    ).then(() => resolve(value), reject);
                  }
                  return resolve(value);
                },
                reject,
              );
            return b;
          };
          return builder;
        },
      };
      const github = await quiet(() =>
        mainRefresh({
          isDryRun: false,
          specificRaceIds: ids,
          client: wrapped,
          writeMode: githubMode,
          now: () => NOW,
        }),
      );
      const races = new Set(fake.state.predictions.map((p) => p.race_id));
      const conflict = github.lines.some((l) =>
        l.includes("predictions書き込みエラー"),
      );
      return { fake, github, races, conflict };
    };

    const upsertBoth = await interleave("upsert", "upsert");

    check(
      "併走（案1の状態: GitHub も Vercel も upsert）: 同じレースを同時に再計算しても、衝突せず、2レースとも予測が残る（6行のまま増えない）",
      !upsertBoth.conflict &&
        !upsertBoth.github.error &&
        upsertBoth.races.size === 2 &&
        upsertBoth.fake.state.predictions.length === 6,
      `予測のあるレース: ${show([...upsertBoth.races])} / ${upsertBoth.fake.state.predictions.length}行`,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（mainRefresh・check・show・raceTables・NOW・quiet） */
export async function runPredictionRefreshScenes3(env) {
  ({ mainRefresh, check, show, raceTables, NOW, quiet } = env);
  await scene4();
}
