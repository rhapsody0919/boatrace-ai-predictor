/**
 * verify-bot-page-function.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { botPageLangPart1 } from "./bot-page-function-scenes-2.js";

let check, escapeHtml, BOT_PAGE_PREFIXED_LANGS, parseJsonLdScripts, getLocaleT, getTodayVenueBreadcrumbItems, isAssistShown, getHomeBlogPosts, fresh, t, stubFetch, jsonResponse, call, links, alternatesOf, hasRawScript;

/** for (const lang of BOT_PAGE_PREFIXED_LANGS) { の中身を割った 2/3 */
async function botPageLangPart2({ SITE, jaVenue, kiryuRaces, lang, tl, vhtml, vmeta }) {
  check(
    `${lang} 会場: canonical`,
    vmeta.canonical,
    `${SITE}/${lang}/venue/1`,
  );
  check(
    `${lang} 会場: 見出し`,
    vhtml.includes(
      `<h1>${escapeHtml(`🏁 ${tl("venues.1")} ${tl("venueRaceList.todayTitle")}`)}</h1>`,
    ),
    true,
  );
  // 見出しの直下の常設の要約2行（BOA-1189）。その言語の文で、h1 の直後に出る
  {
    const { venueSummaryLines } =
      await import("../../../src/utils/venueSummary.js");
    const lines = venueSummaryLines(tl, 1);
    check(
      `${lang} 会場: 要約2行が h1 の直後に出る`,
      vhtml.includes(
        `</h1>\n<p>${escapeHtml(lines.course)}</p>\n<p>${escapeHtml(lines.techniques)}</p>`,
      ),
      true,
    );
    if (lang === BOT_PAGE_PREFIXED_LANGS[0]) {
      const jaLines = venueSummaryLines(t, 1);
      check(
        "ja 会場: 要約2行が h1 の直後に出る",
        jaVenue.includes(
          `</h1>\n<p>${escapeHtml(jaLines.course)}</p>\n<p>${escapeHtml(jaLines.techniques)}</p>`,
        ),
        true,
      );
    }
  }
  check(
    `${lang} 会場: レース詳細へのリンク（人と同じ /${lang}/race/{id}）`,
    links(vhtml),
    kiryuRaces.map(
      (r) =>
        `/${lang}/race/2026-10-11-01-${String(r.raceNo).padStart(2, "0")}`,
    ),
  );
  check(
    `${lang} 会場: リンクの文言・締切の文言はその言語`,
    vhtml.includes(`>${tl("raceCard.view")}</a>`) &&
      vhtml.includes(
        `<span>${tl("home.deadline")}</span> <span>${kiryuRaces[0].startTime}${tl("home.jstNote")}</span>`,
      ),
    true,
  );
  check(
    `${lang} 会場: hreflang は ja と同じ`,
    alternatesOf(vhtml),
    alternatesOf(jaVenue),
  );
  const ld = parseJsonLdScripts(vhtml);
  check(
    `${lang} 会場: 共通の JSON-LD は ja と同じ`,
    ld.slice(0, 3),
    parseJsonLdScripts(jaVenue).slice(0, 3),
  );
  check(`${lang} 会場: パンくず（人の画面と同じ関数の値）`, ld[3], {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: tl("analysisPage.breadcrumbHome"),
        item: `${SITE}/${lang}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: tl("venues.1"),
        item: `${SITE}/${lang}/venue/1`,
      },
    ],
  });
}

/** for (const lang of BOT_PAGE_PREFIXED_LANGS) { の中身を割った 3/3 */
async function botPageLangPart3({ html, json, lang, racerNames, tl }) {
  check(
    `${lang} 会場: パンくずの項目`,
    getTodayVenueBreadcrumbItems(tl, 1, lang),
    [
      { name: tl("analysisPage.breadcrumbHome"), url: `/${lang}/` },
      { name: tl("venues.1"), url: `/${lang}/venue/1` },
    ],
  );

  // 選手名が入らない（本文）
  const pages = [html];
  for (const v of json.data) {
    pages.push(
      (
        await call("venue", `/api/bot-page/${lang}/venue/${v.place_cd}`, {
          langMode: "prefixed",
        })
      ).res.body,
    );
  }
  const body = pages.map((h) => h.split("<body>")[1]).join("\n");
  check(
    `${lang}: 選手名が HTML に無い`,
    racerNames.filter((n) => body.includes(n)).slice(0, 3),
    [],
  );
  check(`${lang}: 生の <script> が無い`, hasRawScript(body), false);

  // 0件
  const empty = {
    success: true,
    scrapedAt: "2026-10-11T12:00:00Z",
    data: [],
  };
  const ev = await call("venue", `/api/bot-page/${lang}/venue/1`, {
    json: empty,
    langMode: "prefixed",
  });
  check(
    `${lang} 0件: 会場は「開催なし」の文言（その言語）`,
    ev.res.statusCode === 200 &&
      ev.res.body.includes(`<p>${tl("home.noRacesToday")}</p>`),
    true,
  );
}

// 説明文の直後の運営・データ・成績の3行（PV09 T2、BOA-1689）。scenes-4 が botPageTopTextPart1 の後に呼ぶ
export async function botPageTopFacts({ lang, tl, body, has, e }) {
  const url = lang === "ja" ? "/api/bot-page/top" : `/api/bot-page/${lang}/top`;
  // 人の HomeAiIntro と同じキー・同じ並び。
  // 時刻は年つきの JST（フィクスチャの scrapedAt 2026-10-11T12:26:47Z → 2026-10-11 21:26）
  const updatedLine = `<time datetime="2026-10-11T12:26:47.061Z">${e(
    tl("home.aiIntro.updated", { year: "2026", month: 10, day: 11, hour: "21", minute: "26" }),
  )}</time>`;
  const factsHtml = [
    `<p>${e(tl("home.aiIntro.lead"))}</p>`,
    "<ul>",
    `<li><span>${e(tl("home.aiIntro.operator", { name: "らぷそでぃ" }))}</span> <a href="/profile">${e(tl("home.aiIntro.profileLink"))}</a></li>`,
    `<li><span>${e(tl("home.aiIntro.data"))}</span> ${updatedLine}</li>`,
    `<li><span>${e(tl("home.aiIntro.results"))}</span> <a href="/accuracy">${e(tl("home.aiIntro.accuracyLink"))}</a> <a href="/hit-races">${e(tl("home.aiIntro.hitRacesLink"))}</a> <span>${e(tl("home.aiIntro.hitRacesNote"))}</span></li>`,
    "</ul>",
    `<p>${e(tl("home.aiIntro.method"))}</p>`,
  ].join("\n");
  check(`${lang} トップ: 説明文の直後に運営・データ・成績の3行`, has(factsHtml), true);
  check(
    `${lang} トップ: /profile・/accuracy・/hit-races へのリンクは1本ずつ（接頭辞なし）`,
    ["/profile", "/accuracy", "/hit-races"].map((href) => body.split(`<a href="${href}">`).length - 1),
    [1, 1, 1],
  );
  check(`${lang} トップ: 3行に的中率・回収率・% が無い`, /的中率|回収率|%/.test(factsHtml), false);
  {
    // transformTodayRaces は scrapedAt が無いと今の時刻で埋めるので、「読めない」値で時刻の無い場合を作る
    const noTime = { ...fresh(), scrapedAt: "not-a-date" };
    const noTimeBody = (
      await call("top", url, { json: noTime, ...(lang === "ja" ? {} : { langMode: "prefixed" }) })
    ).res.body.split("<body>")[1];
    check(
      `${lang} トップ: scrapedAt が読めないと time 要素だけ無く、3行は残る`,
      [
        noTimeBody.includes("<time"),
        noTimeBody.includes(`<li><span>${e(tl("home.aiIntro.data"))}</span></li>`),
        noTimeBody.includes(`<a href="/profile">`),
        noTimeBody.includes(`<span>${e(tl("home.aiIntro.results"))}</span>`),
      ],
      [false, true, true, true],
    );
  }
}

// ---- 11. トップの説明の本文・よくある質問・ブログ欄・案内の帯（人のトップの部分集合） ----
/** for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) { の中身を割った 1/2 */
export async function botPageTopTextPart1({ lang, textOf }) {
  const tl = await getLocaleT(lang);
  const url =
    lang === "ja" ? "/api/bot-page/top" : `/api/bot-page/${lang}/top`;
  const html = (
    await call("top", url, lang === "ja" ? {} : { langMode: "prefixed" })
  ).res.body;
  const body = html.split("<body>")[1];
  const has = (fragment) => body.includes(fragment);
  const e = escapeHtml;
  const showAssist = isAssistShown(lang);

  // 見出し（人の画面と同じ並び: 本日開催中 → AI予想 → 2つで確かめる → よくある質問 → ブログ → 注目・新着）
  const headings = [...body.matchAll(/<h([1-4])>([\s\S]*?)<\/h\1>/g)].map(
    (m) => `h${m[1]} ${textOf(m[2])}`,
  );
  const { popularPosts, newPosts } = getHomeBlogPosts(lang);
  check(`${lang} トップ: 見出しの並び`, headings, [
    `h2 🏁 ${tl("home.todayRaces")} ${(await import("../../../src/utils/formatters.js")).formatDateShortLocalized("2026-10-11", lang)}`,
    `h2 ${tl("home.aiIntro.title")}`,
    `h3 ${tl("home.aiIntro.checkTitle")}`,
    `h3 ${tl("home.aiIntro.faqTitle")}`,
    `h2 📝 ${tl("home.blogTitle")}`,
    `h3 🌟 ${tl("home.popularArticles")}`,
    ...popularPosts.map((p) => `h3 ${p.title}`),
    `h3 🆕 ${tl("home.newArticles")}`,
    ...newPosts.map((p) => `h3 ${p.title}`),
  ]);

  // 紹介文（ja 以外は龍神ソナーだけの文）
  for (const key of [
    "home.aiIntro.lead",
    "home.aiIntro.method",
    showAssist
      ? "home.aiIntro.toolsIntro"
      : "home.aiIntro.toolsIntroSonarOnly",
    "home.aiIntro.sonarWhere",
    "home.aiIntro.sonarQ1",
    "home.aiIntro.sonarQ2",
    "home.aiIntro.step1",
    showAssist ? "home.aiIntro.step3" : "home.aiIntro.step3SonarOnly",
    "home.aiIntro.disclaimer",
    "home.blogDesc",
  ]) {
    check(`${lang} トップ: ${key}`, has(`>${e(tl(key))}<`), true);
  }
  check(
    `${lang} トップ: 操作の2段目（ボタンの文言入り）`,
    has(
      `<li>${e(tl("home.aiIntro.step2", { button: tl("raceCard.view") }))}</li>`,
    ),
    true,
  );
  check(
    `${lang} トップ: 思考アシストのカードは ja だけ（人と同じ判定）`,
    [
      has(`<p>${e(tl("raceDetailPage.assistSwitch.assist"))}</p>`),
      has(`>${e(tl("home.aiIntro.assistWhere"))}<`),
    ],
    [showAssist, showAssist],
  );
  if (!showAssist) {
    check(
      `${lang} トップ: 思考アシストの文（toolsIntro・step3）が無い`,
      [
        has(`>${e(tl("home.aiIntro.toolsIntro"))}<`),
        has(`>${e(tl("home.aiIntro.step3"))}<`),
      ],
      [false, false],
    );
  }

  // リンク（人と同じ href）
  check(
    `${lang} トップ: 開催中の会場から選ぶ（ページ内リンク）と、その先の id`,
    [
      has(`<a href="#today-venues">${e(tl("home.aiIntro.venuesLink"))}</a>`),
      has(`<section id="today-venues">`),
    ],
    [true, true],
  );
  check(
    `${lang} トップ: 成績ページ・的中レースへのリンク（接頭辞なし）`,
    [
      has(`<a href="/accuracy">${e(tl("home.aiIntro.accuracyLink"))}</a>`),
      has(`<a href="/hit-races">${e(tl("home.aiIntro.hitRacesLink"))}</a>`),
    ],
    [true, true],
  );
  const prefix = lang === "ja" ? "" : `/${lang}`;
  return { tl, html, body, has, e, showAssist, popularPosts, newPosts, prefix };
}

async function scene1() {
  {
    const SITE = "https://www.boat-ai.jp";
    const { formatDateShortLocalized } =
      await import("../../../src/utils/formatters.js");
    check("言語版の言語", BOT_PAGE_PREFIXED_LANGS, ["en", "zh-TW", "ko"]);
    const jaTop = (await call("top", "/api/bot-page/top")).res.body;
    const jaVenue = (await call("venue", "/api/bot-page/venue/1")).res.body;
    const json = fresh();
    const kiryuRaces = [...json.data.find((v) => v.place_cd === 1).races].sort(
      (a, b) => a.raceNo - b.raceNo,
    );
    const racerNames = json.data.flatMap((v) =>
      v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
    );
    for (const lang of BOT_PAGE_PREFIXED_LANGS) {
      const { tl, html, vhtml, vmeta } = await botPageLangPart1({ SITE, formatDateShortLocalized, jaTop, kiryuRaces, lang });
      await botPageLangPart2({ SITE, jaVenue, kiryuRaces, lang, tl, vhtml, vmeta });
      await botPageLangPart3({ html, json, lang, racerNames, tl });
    }

    // 404（言語版の関数）
    for (const [page, url] of [
      ["top", "/api/bot-page/fr/top"],
      ["top", "/api/bot-page/ja/top"],
      ["top", "/api/bot-page/EN/top"],
      ["top", "/api/bot-page/top"],
      ["top", "/"],
      ["top", "/fr/"],
      ["top", "/en/x"],
      ["top", "/en/venue/1"],
      ["venue", "/api/bot-page/fr/venue/1"],
      ["venue", "/api/bot-page/en/venue/01"],
      ["venue", "/api/bot-page/en/venue/25"],
      ["venue", "/api/bot-page/en/venue/abc"],
      ["venue", "/api/bot-page/venue/1"],
      ["venue", "/venue/1"],
      ["venue", "/en/venue/0"],
      ["venue", "/en/venue/1/x"],
      ["venue", "/en/"],
    ]) {
      const { res, fetchCalls } = await call(page, url, { langMode: "prefixed" });
      check(`言語版 ${page} ${url}: 404`, res.statusCode, 404);
      check(
        `言語版 ${page} ${url}: no-store`,
        res.headers["cache-control"],
        "no-store",
      );
      check(`言語版 ${page} ${url}: 材料を取りに行かない`, fetchCalls.length, 0);
    }
    // 材料が壊れたら言語版も 503
    const origError = console.error;
    console.error = () => {};
    try {
      const { res } = await call("venue", "/api/bot-page/en/venue/1", {
        langMode: "prefixed",
        fetchImpl: stubFetch(() => jsonResponse({ success: false }, 500)),
      });
      check("言語版: 材料が壊れたら 503", res.statusCode, 503);
    } finally {
      console.error = origError;
    }
    // 対応外の言語の t は例外
    check(
      "getLocaleT: 対応外の言語は例外",
      await getLocaleT("fr").then(
        () => "通った",
        () => "例外",
      ),
      "例外",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・escapeHtml・BOT_PAGE_PREFIXED_LANGS・parseJsonLdScripts・getLocaleT・getTodayVenueBreadcrumbItems・isAssistShown・getHomeBlogPosts・fresh・t・stubFetch・jsonResponse・call・links・alternatesOf・hasRawScript） */
export async function runBotPageFunctionScenes3(env) {
  ({ check, escapeHtml, BOT_PAGE_PREFIXED_LANGS, parseJsonLdScripts, getLocaleT, getTodayVenueBreadcrumbItems, isAssistShown, getHomeBlogPosts, fresh, t, stubFetch, jsonResponse, call, links, alternatesOf, hasRawScript } = env);
  await scene1();
}
