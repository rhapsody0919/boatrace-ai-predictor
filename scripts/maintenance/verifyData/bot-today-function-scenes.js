/**
 * verify-bot-today-function.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-bot-today-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let read, check, NOT_GENERATED_TEXT, createDigestSource, createTodayBotHandler, todayModule, fresh, NOW, ENV, jsonResponse, stubRest, fakeRes, call, bodyOf;

async function scene1() {
  // ---- 4. 失敗と未生成 ----
  {
    const origError = console.error;
    console.error = () => {};
    try {
      const broken = [
        ["days が HTTP 500", stubRest(fresh(), { dayStatus: 500 })],
        ["rows が HTTP 401", stubRest(fresh(), { rowsStatus: 401 })],
        [
          "JSON でない",
          Object.assign(async () => jsonResponse("<html>"), { calls: [] }),
        ],
        [
          "取得で例外",
          Object.assign(
            async () => {
              throw new TypeError("fetch failed");
            },
            { calls: [] },
          ),
        ],
        ["rows が配列でない", stubRest({ day: fresh().day, rows: { x: 1 } })],
        [
          "レースの行の会場コードが範囲外",
          stubRest({
            day: fresh().day,
            rows: [
              {
                section: "nige",
                rank: 1,
                race_id: "2026-10-12-30-01",
                venue_code: 30,
                race_number: 1,
              },
            ],
          }),
        ],
        ["days が2行", stubRest({ day: [{}, {}], rows: [] })],
      ];
      for (const [label, fetchImpl] of broken) {
        const { res } = await call({ fetchImpl });
        check(`${label}: 503`, res.statusCode, 503);
        check(`${label}: no-store`, res.headers["cache-control"], "no-store");
        check(
          `${label}: 「まだ公開されていません」にしない`,
          (res.body ?? "").includes("公開されていません"),
          false,
        );
      }
      const noEnv = await call({ env: {} });
      check("環境変数が無い: 503", noEnv.res.statusCode, 503);
    } finally {
      console.error = origError;
    }

    const none = await call({ fetchImpl: stubRest({ day: [], rows: [] }) });
    check("行が無い: 200", none.res.statusCode, 200);
    check(
      "行が無い: 「まだ公開されていません」",
      bodyOf(none.res.body).includes(`<p>${NOT_GENERATED_TEXT}</p>`),
      true,
    );
    check(
      "行が無い: 日付だけ",
      bodyOf(none.res.body).includes("<p>10月12日（月）</p>"),
      true,
    );
    check(
      "行が無い: セクション・用語は出さない（人も出さない）",
      bodyOf(none.res.body).includes("<h2>"),
      false,
    );
    const half = fresh();
    half.day[0].generated_at = null;
    const midway = await call({ fetchImpl: stubRest(half) });
    check(
      "generated_at が NULL（生成の途中）: 「まだ公開されていません」",
      bodyOf(midway.res.body).includes(NOT_GENERATED_TEXT),
      true,
    );
  }
}

async function scene2() {
  // ---- 5. 日付・使い回し・メソッド ----
  {
    let clock = NOW;
    const now = () => clock;
    const f = stubRest();
    const getDigest = createDigestSource({ fetchImpl: f, now, env: ENV });
    const h = createTodayBotHandler({ getDigest, now });
    const hit = async () => {
      const res = fakeRes();
      await h({ method: "GET", url: "/today", headers: {} }, res);
      return res.statusCode;
    };
    await hit();
    clock = NOW + 59_000;
    await hit();
    check(
      "使い回し: 60秒以内は1回（days・rows で2リクエスト）",
      f.calls.length,
      2,
    );
    clock = NOW + 61_000;
    await hit();
    check("使い回し: 61秒後に取り直す", f.calls.length, 4);
    // JST の日付が変わったら別の日付で取り直す（15:00Z = 翌日 0:00 JST）
    clock = Date.parse("2026-10-12T15:00:00Z");
    await hit();
    check(
      "JST の日付が変わったら翌日を読む",
      f.calls.at(-1).url.match(/digest_date=eq\.([\d-]+)/)?.[1],
      "2026-10-13",
    );
    const post = await call({ method: "POST" });
    check(
      "POST: 405",
      [post.res.statusCode, post.res.headers.allow],
      [405, "GET, HEAD"],
    );
  }
  // ---- 6. エスケープ・配置 ----
  {
    const fx = fresh();
    fx.rows[0].reason = `<script>alert("x")</script>&'"`;
    const { res } = await call({ fetchImpl: stubRest(fx) });
    check(
      "理由の文はエスケープする",
      bodyOf(res.body).includes(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;",
      ),
      true,
    );
    check(
      "生の <script> が無い（JSON-LD 以外）",
      /<script(?! type="application\/ld\+json">)/i.test(res.body),
      false,
    );
    const vercel = JSON.parse(read("vercel.json"));
    check(
      "vercel.json: api/bot-page/**/*.js は syd1",
      vercel.functions?.["api/bot-page/**/*.js"]?.regions,
      ["syd1"],
    );
    check(
      "today.js は edge でない",
      todayModule.config?.runtime === "edge",
      false,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・check・NOT_GENERATED_TEXT・createDigestSource・createTodayBotHandler・todayModule・fresh・NOW・ENV・jsonResponse・stubRest・fakeRes・call・bodyOf） */
export async function runBotTodayFunctionScenes1(env) {
  ({ read, check, NOT_GENERATED_TEXT, createDigestSource, createTodayBotHandler, todayModule, fresh, NOW, ENV, jsonResponse, stubRest, fakeRes, call, bodyOf } = env);
  await scene1();
  await scene2();
}
