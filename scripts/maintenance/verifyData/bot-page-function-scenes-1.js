/**
 * verify-bot-page-function.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let read, check, createTodayRacesSource, createBotPageHandler, BOT_PAGE_PREFIXED_LANGS, fresh, NOW, HOST, t, fakeRes, stubFetch, jsonResponse, call, SUCCESS_CC, todaySection, venueLinks, hasRawScript;

async function scene1() {
  // ---- 4. 失敗と0件 ----
  {
    const broken = [
      ["HTTP 500", stubFetch(() => jsonResponse({ success: false }, 500))],
      ["JSON でない", stubFetch(() => jsonResponse("<html>oops</html>"))],
      [
        "success が false",
        stubFetch(() => jsonResponse({ success: false, data: [] })),
      ],
      [
        "data が配列でない",
        stubFetch(() => jsonResponse({ success: true, data: null })),
      ],
      [
        "会場コードが範囲外",
        stubFetch(() =>
          jsonResponse({ success: true, data: [{ place_cd: 99, races: [] }] }),
        ),
      ],
      [
        "取得で例外",
        stubFetch(() => {
          throw new TypeError("fetch failed");
        }),
      ],
    ];
    const origError = console.error;
    console.error = () => {};
    try {
      for (const [label, fetchImpl] of broken) {
        for (const [page, url] of [
          ["top", "/api/bot-page/top"],
          ["venue", "/api/bot-page/venue/1"],
        ]) {
          const { res } = await call(page, url, { fetchImpl });
          check(`材料が壊れた（${label}・${page}）: 503`, res.statusCode, 503);
          check(
            `材料が壊れた（${label}・${page}）: no-store`,
            res.headers["cache-control"],
            "no-store",
          );
          check(
            `材料が壊れた（${label}・${page}）: Retry-After`,
            res.headers["retry-after"],
            "300",
          );
          check(
            `材料が壊れた（${label}・${page}）: 「開催なし」にならない`,
            /開催/.test(res.body ?? ""),
            false,
          );
        }
      }
    } finally {
      console.error = origError;
    }

    const empty = { success: true, scrapedAt: "2026-10-11T12:00:00Z", data: [] };
    const top = await call("top", "/api/bot-page/top", { json: empty });
    check("0件: トップは 200", top.res.statusCode, 200);
    check("0件: トップは会場へのリンクなし", venueLinks(top.res.body), []);
    check(
      "0件: トップは24会場の名前",
      (todaySection(top.res.body).match(/<li>/g) || []).length,
      24,
    );
    const venue = await call("venue", "/api/bot-page/venue/1", { json: empty });
    check("0件: 会場は 200", venue.res.statusCode, 200);
    check(
      "0件: 会場の Cache-Control",
      venue.res.headers["cache-control"],
      SUCCESS_CC,
    );
    check(
      "0件: 会場は「開催なし」",
      venue.res.body.includes(`<p>${t("home.noRacesToday")}</p>`),
      true,
    );
  }
}

async function scene2() {
  // ---- 5. 会場コード・メソッド ----
  for (const url of [
    "/api/bot-page/venue/0",
    "/api/bot-page/venue/25",
    "/api/bot-page/venue/01",
    "/api/bot-page/venue/abc",
    "/api/bot-page/venue/1.5",
    "/api/bot-page/venue/-1",
    "/api/bot-page/venue/",
    "/api/bot-page/venue/1/x",
    "/api/bot-page/venue/%31",
    // middleware の rewrite 経由では req.url が元のパスのまま届く。0埋め・範囲外・接頭辞付きは 404
    "/venue/01",
    "/venue/25",
    "/en/venue/1",
    "/x/venue/1",
  ]) {
    const { res, fetchCalls } = await call("venue", url);
    check(`${url}: 404`, res.statusCode, 404);
    check(`${url}: no-store`, res.headers["cache-control"], "no-store");
    check(`${url}: 材料を取りに行かない`, fetchCalls.length, 0);
  }
  for (const code of [9, 10, 24]) {
    const { res } = await call("venue", `/api/bot-page/venue/${code}`);
    check(`/api/bot-page/venue/${code}: 200`, res.statusCode, 200);
  }
  // middleware の rewrite 経由（req.url が /venue/{code} のまま）でも同じ会場の HTML になる
  for (const code of [1, 24]) {
    const viaRewrite = await call("venue", `/venue/${code}?x=1`);
    const direct = await call("venue", `/api/bot-page/venue/${code}`);
    check(
      `/venue/${code}?x=1（rewrite 経由）: 200`,
      viaRewrite.res.statusCode,
      200,
    );
    check(
      `/venue/${code}（rewrite 経由）: 直接呼んだときと同じ HTML`,
      viaRewrite.res.body === direct.res.body,
      true,
    );
  }
  {
    const { res, fetchCalls } = await call("top", "/api/bot-page/top", {
      method: "POST",
    });
    check("POST: 405", res.statusCode, 405);
    check("POST: Allow", res.headers.allow, "GET, HEAD");
    check("POST: 材料を取りに行かない", fetchCalls.length, 0);
  }
  // ---- 6. エスケープ ----
  {
    const json = fresh();
    const evil = `<script>alert("x")</script>&'"`;
    const kiryu = json.data.find((v) => v.place_cd === 1);
    for (const r of kiryu.races) r.raceTitle = evil;
    const top = (await call("top", "/api/bot-page/top", { json })).res.body;
    const venue = (await call("venue", "/api/bot-page/venue/1", { json })).res
      .body;
    const escaped =
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;";
    check("エスケープ: トップに生の <script> が無い", hasRawScript(top), false);
    check(
      "エスケープ: トップの本文はエスケープ済み",
      top.includes(escaped),
      true,
    );
    check("エスケープ: 会場に生の <script> が無い", hasRawScript(venue), false);
    // 一般戦は title に節の名前が入らないので、SG にして title・description（属性）に入れる
    for (const r of kiryu.races) r.raceGrade = "SG";
    const sg = (await call("venue", "/api/bot-page/venue/1", { json })).res.body;
    check(
      "エスケープ: title に入る節の名前",
      sg.includes(`<title>${escaped}`) || /<title>[^<]*&lt;script&gt;/.test(sg),
      true,
    );
    check(
      'エスケープ: description（属性）に生の " や < が無い',
      /<meta name="description" content="[^"<>]*">/.test(sg),
      true,
    );
    check(
      "エスケープ: SG の会場にも生の <script> が無い",
      hasRawScript(sg),
      false,
    );
  }
}

async function scene3() {
  // ---- 7. 60秒の使い回し ----
  {
    let clock = NOW;
    const now = () => clock;
    const f = stubFetch(() => jsonResponse(fresh()));
    const getTodayJson = createTodayRacesSource({ fetchImpl: f, now });
    const top = createBotPageHandler("top", { getTodayJson, now });
    const venue = createBotPageHandler("venue", { getTodayJson, now });
    const hit = async (h, url) => {
      const res = fakeRes();
      await h({ method: "GET", url, headers: { host: HOST } }, res);
      return res.statusCode;
    };
    await hit(top, "/api/bot-page/top");
    clock = NOW + 30_000;
    await hit(venue, "/api/bot-page/venue/1");
    clock = NOW + 59_999;
    await hit(top, "/api/bot-page/top");
    check("使い回し: 60秒以内は1回だけ取る", f.calls.length, 1);
    clock = NOW + 61_000;
    check("使い回し: 61秒後も 200", await hit(top, "/api/bot-page/top"), 200);
    check("使い回し: 61秒後に取り直す", f.calls.length, 2);

    // 取得中の同時呼び出しは1回の取得を待つ
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const slow = stubFetch(async () => {
      await gate;
      return jsonResponse(fresh());
    });
    const shared = createTodayRacesSource({ fetchImpl: slow, now });
    const pending = Promise.all([
      shared(`https://${HOST}`),
      shared(`https://${HOST}`),
    ]);
    release();
    await pending;
    check("使い回し: 同時の2回は取得1回", slow.calls.length, 1);

    // 失敗は使い回さない（次の呼び出しで取り直す）
    let fail = true;
    const flaky = stubFetch(() =>
      fail ? jsonResponse({}, 500) : jsonResponse(fresh()),
    );
    const src = createTodayRacesSource({ fetchImpl: flaky, now });
    await src(`https://${HOST}`).catch(() => {});
    fail = false;
    await src(`https://${HOST}`);
    check("使い回し: 失敗の直後に取り直す", flaky.calls.length, 2);
  }
  // ---- 8. 配置（Node・syd1） ----
  {
    const vercel = JSON.parse(read("vercel.json"));
    const fn = vercel.functions?.["api/bot-page/**/*.js"];
    check("vercel.json: syd1", fn?.regions, ["syd1"]);
    check(
      "vercel.json: 4言語の文言のファイルと index.html（共通の JSON-LD）とブログ記事のメタデータ（トップのブログ欄）を同梱",
      fn?.includeFiles,
      "{src/locales/ja/common.json,src/locales/en/common.json,src/locales/zh-TW/common.json,src/locales/ko/common.json,index.html,src/data/blog-posts/**/*.json}",
    );
    check(
      "vercel.json: 同梱する文言のファイルが言語版の言語と ja をすべて含む",
      ["ja", ...BOT_PAGE_PREFIXED_LANGS].every((l) =>
        fn?.includeFiles?.includes(`src/locales/${l}/common.json`),
      ),
      true,
    );
    for (const rel of [
      "api/bot-page/top.js",
      "api/bot-page/venue/[code].js",
      "api/bot-page/[lang]/top.js",
      "api/bot-page/[lang]/venue/[code].js",
    ]) {
      check(
        `${rel}: edge でない`,
        /runtime\s*:\s*["']edge["']/.test(read(rel)),
        false,
      );
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・check・createTodayRacesSource・createBotPageHandler・BOT_PAGE_PREFIXED_LANGS・fresh・NOW・HOST・t・fakeRes・stubFetch・jsonResponse・call・SUCCESS_CC・todaySection・venueLinks・hasRawScript） */
export async function runBotPageFunctionScenes1(env) {
  ({ read, check, createTodayRacesSource, createBotPageHandler, BOT_PAGE_PREFIXED_LANGS, fresh, NOW, HOST, t, fakeRes, stubFetch, jsonResponse, call, SUCCESS_CC, todaySection, venueLinks, hasRawScript } = env);
  await scene1();
  await scene2();
  await scene3();
}
