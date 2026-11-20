/**
 * verify-bot-page-function.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { botPageTopTextPart1 } from "./bot-page-function-scenes-3.js";

let read, check, parseJsonLdScripts, BOT_PAGE_PREFIXED_LANGS, getLocaleT, escapeHtml, buildFaqItems, fresh, jsonResponse, call, decode, links, hasRawScript;

/** for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) { の中身を割った 2/2 */
function botPageTopTextPart2({ body, e, has, html, lang, newPosts, popularPosts, prefix, racerNames, showAssist, tl }) {
  check(
    `${lang} トップ: ブログの記事へのリンク（注目3・新着3、人と同じ順）`,
    links(body).filter((h) => /\/blog\/./.test(h)),
    [...popularPosts, ...newPosts].map((p) => `${prefix}/blog/${p.id}`),
  );
  check(
    `${lang} トップ: 注目3本・新着3本`,
    [popularPosts.length, newPosts.length],
    [3, 3],
  );
  check(
    `${lang} トップ: ブログ一覧へのリンク`,
    has(`<a href="${prefix}/blog">${e(tl("home.viewAllPosts"))}</a>`),
    true,
  );

  // 案内の帯（ja は人の画面が初回訪問の案内カードを出すので無い）
  check(
    `${lang} トップ: 案内の帯`,
    has(`<a href="${prefix}/about">${e(tl("home.introBannerText"))}</a>`),
    lang !== "ja",
  );
  check(
    `${lang} トップ: 帯の閉じるボタンなど操作の部品が無い`,
    /<button|<input|<form/i.test(body),
    false,
  );

  // よくある質問: 画面の問い・答えが人と同じ関数の値で、FAQPage の JSON-LD と一致する
  const faqItems = buildFaqItems(tl, showAssist);
  const shown = [
    ...body.matchAll(
      /<details open>\n<summary>([\s\S]*?)<\/summary>\n<p>([\s\S]*?)<\/p>\n<\/details>/g,
    ),
  ].map((m) => ({ question: decode(m[1]), answer: decode(m[2]) }));
  check(
    `${lang} トップ: よくある質問5問（人と同じ関数の値）`,
    shown,
    faqItems,
  );
  const faqLd = parseJsonLdScripts(html).find(
    (ld) => ld["@type"] === "FAQPage",
  );
  check(
    `${lang} トップ: FAQPage の問い・答えが画面の文言と一致`,
    faqLd?.mainEntity?.map((q) => ({
      question: q.name,
      answer: q.acceptedAnswer?.text,
    })),
    shown,
  );

  // 入れないもの: イン崩れ注意度のハイライト・選手名・オッズ
  const volatilityKeys = [
    "home.volatilityHighlightsTitle",
    "home.volatilityHighlightsScaleNote",
    "home.volatilityHighlightsAccuracyLink",
  ];
  check(
    `${lang} トップ: イン崩れ注意度のハイライトが無い`,
    volatilityKeys.filter((k) => has(e(tl(k)))),
    [],
  );
  check(
    `${lang} トップ: 選手名が無い`,
    racerNames.filter((n) => body.includes(n)).slice(0, 3),
    [],
  );
}

// BOA-1237: head の SNS メタは各1件、既存のページメタと同じ値。
function checkSocialMeta(label, html) {
  const head = html.split("<head>")[1].split("</head>")[0];
  const title = head.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  const description = head.match(/<meta name="description" content="([^"]*)">/)?.[1];
  const canonical = head.match(/<link rel="canonical" href="([^"]*)">/)?.[1];
  const image = "https://www.boat-ai.jp/ogp-image.png";
  const expected = {
    "og:type": "website", "og:site_name": "龍神レーダー",
    "og:title": title, "og:description": description, "og:url": canonical,
    "og:image": image, "twitter:card": "summary_large_image",
    "twitter:title": title, "twitter:description": description, "twitter:image": image,
  };
  for (const [key, value] of Object.entries(expected)) {
    const attr = key.startsWith("og:") ? "property" : "name";
    const tags = [...head.matchAll(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`, "g"))];
    check(`${label}: ${key} は1件で値が一致`, tags.map((m) => m[1]), [value]);
  }
}

async function scene1() {
  {
    const json = fresh();
    const racerNames = json.data.flatMap((v) =>
      v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
    );
    const textOf = (fragment) =>
      decode(fragment.replace(/<[^>]+>/g, "").trim()) ?? "";
    for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) {
      const { tl, html, body, has, e, showAssist, popularPosts, newPosts, prefix } = await botPageTopTextPart1({ lang, textOf });
      botPageTopTextPart2({ body, e, has, html, lang, newPosts, popularPosts, prefix, racerNames, showAssist, tl });
    }

    // エスケープ: 文言（t）と記事以外の値が全部 < > & ' " を含んでも、生のタグにならず、FAQPage は元の値に戻る
    const evil = `<script>alert("x")</script>&'"`;
    const { buildTopModel } = await import("../../../src/utils/botPageModel.js");
    const { renderTopHtml } = await import("../../../api/_lib/botPage.js");
    const evilModel = buildTopModel(fresh(), {
      t: () => evil,
      today: "2026-10-11",
      lang: "en",
    });
    const evilHtml = renderTopHtml(evilModel);
    check(
      "エスケープ: トップの文言に生の <script> が無い",
      hasRawScript(evilHtml),
      false,
    );
    check(
      "エスケープ: 文言はエスケープ済みで出る",
      evilHtml.includes(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;",
      ),
      true,
    );
    check(
      "エスケープ: FAQPage は読み戻すと元の値",
      parseJsonLdScripts(evilHtml)[0].mainEntity[0].name,
      evil,
    );
    // 記事の値（タイトル・説明）もエスケープする
    const postModel = structuredClone(evilModel);
    postModel.blog.groups[0].posts[0].title = evil;
    postModel.blog.groups[0].posts[0].href = `/blog/"><script>`;
    const postHtml = renderTopHtml(postModel);
    check(
      "エスケープ: 記事のタイトル・リンク先",
      [
        hasRawScript(postHtml),
        postHtml.includes('href="/blog/&quot;&gt;&lt;script&gt;"'),
      ],
      [false, true],
    );
  }
  // BOA-1219: handler まで通して、取得条件・失敗・各言語・エスケープを確かめる。
  {
    const json = fresh();
    const races = json.data.find((v) => v.place_cd === 1).races;
    const row = { start_date: "2026-10-06", end_date: "2026-10-11", title: "節", grade: "SG", venue_code: 1, total_days: 6, class_code: "SG", kind: "sg" };
    let reads = 0;
    const getSeriesRows = async () => { reads++; return [row]; };
    for (const grade of ["SG", "G1", "G2"]) {
      races.forEach((r) => { r.raceGrade = grade; r.raceTitle = '<節&"公式>'; });
      for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) {
        const tl = await getLocaleT(lang);
        const prefix = lang === "ja" ? "" : `/${lang}`;
        const { res } = await call("venue", `/api/bot-page${prefix}/venue/1`, {
          json, getSeriesRows, ...(lang === "ja" ? {} : { langMode: "prefixed" }),
        });
        check(`${grade}/${lang}: リンク1件`, links(res.body).filter((h) => h.includes("/meet/")), [`${prefix}/venue/1/meet/2026-10-06`]);
        check(`${lang}: 公式名と文言`, res.body.includes(`<span translate="no">${escapeHtml(`${grade} <節&"公式>`)}</span> ${escapeHtml(tl("venueMeetBanner.inProgress"))}`) && res.body.includes(`>${escapeHtml(tl("venueMeetBanner.link"))}</a>`), true);
      }
    }
    for (const [grade, title] of [["ippan", "一般"], ["SG", "グランプリ"]]) {
      races.forEach((r) => { r.raceGrade = grade; r.raceTitle = title; });
      const before = reads;
      const { res } = await call("venue", "/venue/1", { json, getSeriesRows });
      check("対象外は取得なし・リンクなし", [reads - before, links(res.body).some((h) => h.includes("/meet/"))], [0, false]);
    }
    races.forEach((r) => { r.raceGrade = "G1"; r.raceTitle = "節"; });
    const originalError = console.error;
    console.error = () => {};
    try {
      for (const getRows of [async () => { throw new Error("取得失敗"); }, async () => ({}), async () => [null], async () => [{ ...row, end_date: "bad" }]]) {
        const { res } = await call("venue", "/venue/1", { json, getSeriesRows: getRows });
        check("節の取得失敗・不正な形: 503", [res.statusCode, res.headers["retry-after"], res.headers["cache-control"]], [503, "300", "no-store"]);
      }
    } finally { console.error = originalError; }
  }
}

async function scene2() {
  // REST の取り口は実接続せず検査する。失敗をキャッシュしない。
  {
    const { createSeriesSource } = await import("../../../api/_lib/botPage.js");
    const row = { start_date: "2026-10-06", end_date: "2026-10-11", title: null, grade: "G1", venue_code: 1, total_days: 6, class_code: "G1", kind: "g1" };
    const calls = [];
    let clock = 0;
    let broken = false;
    const source = createSeriesSource({
      env: { SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "fixture-anon" },
      now: () => clock,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        await Promise.resolve();
        return jsonResponse(broken ? {} : [row]);
      },
    });
    const [first] = await Promise.all([source(1, "2026-10-11"), source(1, "2026-10-11")]);
    check("節REST: 同時取得1回・行は makeMeet で凍結", [calls.length, Object.isFrozen(first[0])], [1, true]);
    const url = new URL(calls[0].url);
    check("節REST: 人と同じクエリ", Object.fromEntries(url.searchParams), {
      venue_code: "eq.1", start_date: "lte.2026-10-11", order: "start_date.desc", limit: "1", select: "start_date,end_date,title,grade,venue_code,total_days,class_code,kind",
    });
    check("節REST: anon と timeout", [calls[0].options.headers.apikey, calls[0].options.headers.Authorization, calls[0].options.signal instanceof AbortSignal], ["fixture-anon", "Bearer fixture-anon", true]);
    clock = 59000;
    await source(1, "2026-10-11");
    check("節REST: 59秒は使い回す", calls.length, 1);
    clock = 61000;
    broken = true;
    check("節REST: 壊れた応答は例外", await source(1, "2026-10-11").then(() => false, () => true), true);
    broken = false;
    await source(1, "2026-10-11");
    check("節REST: 失敗後は取り直す", calls.length, 3);
    await source(2, "2026-10-11");
    await source(1, "2026-10-12");
    check("節REST: 会場・日付を混ぜない", calls.length, 5);
    // makeMeet の破れ（人の画面の getSeriesOfDate と同じ検査: total_days が日程と合わない・class_code が不明）も「帯なし」でなく例外
    for (const response of [() => jsonResponse([], 500), () => new Response("not json"), () => { throw new Error("offline"); }, () => jsonResponse([{ ...row, total_days: 5 }]), () => jsonResponse([{ ...row, class_code: "G9" }])]) {
      const getRows = createSeriesSource({ env: { SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "fixture" }, fetchImpl: async () => response() });
      check("節REST: HTTP/JSON/通信失敗は例外", await getRows(1, "2026-10-11").then(() => false, () => true), true);
    }
  }
  for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) {
    const prefix = lang === "ja" ? "" : `/${lang}`;
    for (const page of ["top", "venue"]) {
      const url = `/api/bot-page${prefix}/${page === "top" ? "top" : "venue/1"}`;
      const { res } = await call(page, url, lang === "ja" ? {} : { langMode: "prefixed" });
      checkSocialMeta(`${lang}/${page}`, res.body);
    }
  }
  {
    const { documentHtml } = await import("../../../api/_lib/botPage.js");
    const evil = `<節&"'>`;
    const html = documentHtml({ title: evil, description: evil, canonical: evil }, "", {
      path: "/", lang: "ja", jsonLd: [],
    });
    checkSocialMeta("特殊文字", html);
    check("SNS メタ: 属性の特殊文字をエスケープ", html.includes(`content="${escapeHtml(evil)}"`), true);
    check("SNS メタ: 生の値が無い", html.includes(evil), false);
    const index = read("index.html");
    for (const attr of ['property="og:image"', 'name="twitter:image"']) {
      check(`index.html と画像URLが一致: ${attr}`, index.includes(`<meta ${attr} content="https://www.boat-ai.jp/ogp-image.png"`), true);
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・check・parseJsonLdScripts・BOT_PAGE_PREFIXED_LANGS・getLocaleT・escapeHtml・buildFaqItems・fresh・jsonResponse・call・decode・links・hasRawScript） */
export async function runBotPageFunctionScenes4(env) {
  ({ read, check, parseJsonLdScripts, BOT_PAGE_PREFIXED_LANGS, getLocaleT, escapeHtml, buildFaqItems, fresh, jsonResponse, call, decode, links, hasRawScript } = env);
  await scene1();
  await scene2();
}
