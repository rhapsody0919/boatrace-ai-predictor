/**
 * verify-bot-page-function.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let read, check, parseJsonLdScripts, jsonLdScriptText, renderVenueHtml, getLocaleT, escapeHtml, getTodayVenueBreadcrumbItems, getTopPageMeta, getTodayVenuePageMeta, toFaqPageLd, buildFaqItems, isAssistShown, t, call, SUCCESS_CC, headOf, expectedHead, venueLinks, alternatesOf, hasRawScript;

// ---- 10. 言語版（BOA-848 第2段） ----
/** for (const lang of BOT_PAGE_PREFIXED_LANGS) { の中身を割った 1/3 */
export async function botPageLangPart1({ SITE, formatDateShortLocalized, jaTop, kiryuRaces, lang }) {
  const tl = await getLocaleT(lang);
  check(
    `${lang}: 文言はその言語（ja と違う）`,
    tl("home.todayRaces") !== t("home.todayRaces"),
    true,
  );

  // トップ: 直接・rewrite 経由（/{lang}/ と /{lang}）が同じ HTML
  const direct = await call("top", `/api/bot-page/${lang}/top`, {
    langMode: "prefixed",
  });
  check(`${lang} トップ: 200`, direct.res.statusCode, 200);
  check(
    `${lang} トップ: Cache-Control`,
    direct.res.headers["cache-control"],
    SUCCESS_CC,
  );
  const html = direct.res.body;
  for (const viaPath of [`/${lang}/`, `/${lang}`, `/${lang}/?x=1`]) {
    const via = await call("top", viaPath, { langMode: "prefixed" });
    check(
      `${lang} トップ: ${viaPath}（rewrite 経由）は直接と同じ HTML`,
      via.res.body === html,
      true,
    );
  }
  const meta = getTopPageMeta(tl, lang);
  check(`${lang} トップ: head`, headOf(html), {
    ...expectedHead(meta),
    lang,
  });
  check(`${lang} トップ: canonical`, meta.canonical, `${SITE}/${lang}/`);
  check(
    `${lang} トップ: 見出し`,
    html.includes(
      `<h2>${escapeHtml(`🏁 ${tl("home.todayRaces")} ${formatDateShortLocalized("2026-10-11", lang)}`)}</h2>`,
    ),
    true,
  );
  check(
    `${lang} トップ: 会場へのリンク（人と同じ /${lang}/venue/N）`,
    venueLinks(html),
    [1, 2, 3, 6, 8, 9, 12, 15, 16, 18, 19, 22, 23].map(
      (c) => `/${lang}/venue/${c}`,
    ),
  );
  check(
    `${lang} トップ: 会場名はその言語`,
    html.includes(`<li>${tl("venues.4")}</li>`),
    true,
  );
  check(
    `${lang} トップ: hreflang は ja と同じ`,
    alternatesOf(html),
    alternatesOf(jaTop),
  );
  check(
    `${lang} トップ: JSON-LD は ja と同じ index.html の共通と、その言語の FAQPage`,
    parseJsonLdScripts(html),
    [
      ...parseJsonLdScripts(jaTop).slice(0, 3),
      toFaqPageLd(buildFaqItems(tl, isAssistShown(lang))),
    ],
  );

  // 会場
  const venue = await call("venue", `/api/bot-page/${lang}/venue/1`, {
    langMode: "prefixed",
  });
  check(`${lang} 会場: 200`, venue.res.statusCode, 200);
  const vhtml = venue.res.body;
  const viaVenue = await call("venue", `/${lang}/venue/1?x=1`, {
    langMode: "prefixed",
  });
  check(
    `${lang} 会場: /${lang}/venue/1?x=1（rewrite 経由）は直接と同じ HTML`,
    viaVenue.res.body === vhtml,
    true,
  );
  const vmeta = getTodayVenuePageMeta(tl, 1, kiryuRaces, lang);
  check(`${lang} 会場: head`, headOf(vhtml), {
    ...expectedHead(vmeta),
    lang,
  });
  return { tl, html, vhtml, vmeta };
}

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const SITE = "https://www.boat-ai.jp";
  // 人のページの HreflangTags が出す行（src/config/languages.js の SUPPORTED_LANGUAGES・localizePath の結果）
  const expectedAlternates = (base) => [
    { hreflang: "ja", href: `${SITE}${base}` },
    { hreflang: "en", href: `${SITE}/en${base === "/" ? "/" : base}` },
    { hreflang: "zh-Hant", href: `${SITE}/zh-TW${base === "/" ? "/" : base}` },
    { hreflang: "ko", href: `${SITE}/ko${base === "/" ? "/" : base}` },
    { hreflang: "x-default", href: `${SITE}${base}` },
  ];
  // 人のページの初期 HTML（index.html）の共通の JSON-LD
  const siteLd = parseJsonLdScripts(read("index.html"));
  check(
    "index.html の共通の JSON-LD の型",
    siteLd.map((ld) => ld["@type"]),
    ["WebSite", "SoftwareApplication", "Organization"],
  );
  const top = (await call("top", "/api/bot-page/top")).res.body;
  check("hreflang: トップ", alternatesOf(top), expectedAlternates("/"));
  const topLd = parseJsonLdScripts(top);
  check(
    "JSON-LD: トップは index.html の共通と、人の HomeAiIntro と同じ FAQPage（型・中身）",
    topLd,
    [...siteLd, toFaqPageLd(buildFaqItems(t, isAssistShown("ja")))],
  );
  check(
    "hreflang・JSON-LD は head の中",
    top.split("</head>")[1].includes("ld+json") ||
      top.split("</head>")[1].includes('rel="alternate"'),
    false,
  );
  const venue = (await call("venue", "/api/bot-page/venue/1")).res.body;
  check("hreflang: 会場", alternatesOf(venue), expectedAlternates("/venue/1"));
  const venueLd = parseJsonLdScripts(venue);
  check(
    "JSON-LD: 会場の型（共通の3つ＋パンくず）",
    venueLd.map((ld) => ld["@type"]),
    ["WebSite", "SoftwareApplication", "Organization", "BreadcrumbList"],
  );
  check(
    "JSON-LD: 会場の共通部分は index.html と同じ",
    venueLd.slice(0, 3),
    siteLd,
  );
  // 人の会場ページの Breadcrumb（ホーム › 桐生）と同じ
  check("JSON-LD: 会場のパンくず", venueLd[3], {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ホーム", item: `${SITE}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "桐生",
        item: `${SITE}/venue/1`,
      },
    ],
  });
  check(
    "パンくずの項目は人の画面と同じ関数の値",
    getTodayVenueBreadcrumbItems(t, 1),
    [
      { name: "ホーム", url: "/" },
      { name: "桐生", url: "/venue/1" },
    ],
  );
  // 0件の日も同じ head（人の会場ページは0件でもパンくずを出す）
  const empty = { success: true, scrapedAt: "2026-10-11T12:00:00Z", data: [] };
  return { SITE, venue, venueLd, empty };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ SITE, venue, venueLd, empty }) {
  const emptyVenue = (
    await call("venue", "/api/bot-page/venue/1", { json: empty })
  ).res.body;
  check(
    "0件: 会場の hreflang・JSON-LD の型は同じ",
    [
      alternatesOf(emptyVenue),
      parseJsonLdScripts(emptyVenue).map((ld) => ld["@type"]),
    ],
    [alternatesOf(venue), venueLd.map((ld) => ld["@type"])],
  );
  // </script> を含む値で要素が閉じない
  const evil = `</script><script>alert("x")</script><!--&\u2028`;
  check(
    "jsonLdScriptText: < > & を \\uXXXX にする",
    /[<>&]/.test(jsonLdScriptText({ name: evil })),
    false,
  );
  check(
    "jsonLdScriptText: JSON として読むと元の値",
    JSON.parse(jsonLdScriptText({ name: evil })).name,
    evil,
  );
  const evilSite = await call("top", "/api/bot-page/top", {
    getSiteJsonLd: async () => [{ "@type": "WebSite", name: evil }],
  });
  check(
    "</script>: 共通の JSON-LD の値でも要素が閉じない（<script> は共通の1つと FAQPage だけ）",
    [
      (evilSite.res.body.match(/<script/g) || []).length,
      (evilSite.res.body.match(/<\/script>/g) || []).length,
      hasRawScript(evilSite.res.body),
    ],
    [2, 2, false],
  );
  check(
    "</script>: 読み戻すと元の値",
    parseJsonLdScripts(evilSite.res.body)[0].name,
    evil,
  );
  const venueModelHtml = renderVenueHtml(
    {
      path: "/venue/1",
      meta: { title: "t", description: "d", canonical: `${SITE}/venue/1` },
      heading: "h",
      emptyText: "e",
      races: [],
      breadcrumbItems: [
        { name: "ホーム", url: "/" },
        { name: evil, url: "/venue/1" },
      ],
    },
    "v",
  );
  check(
    "</script>: パンくずの名前でも要素が閉じない",
    [
      hasRawScript(venueModelHtml),
      parseJsonLdScripts(venueModelHtml)[0].itemListElement[1].name,
    ],
    [false, evil],
  );
  // index.html が読めない・JSON-LD が壊れていたら 503（黙って JSON-LD を落とさない）
  const origError = console.error;
  console.error = () => {};
  try {
    const broken = await call("top", "/api/bot-page/top", {
      getSiteJsonLd: async () => {
        throw new Error("index.html が無い");
      },
    });
    check("共通の JSON-LD が読めない: 503", broken.res.statusCode, 503);
  } finally {
    console.error = origError;
  }
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3() {
  check(
    "parseJsonLdScripts: JSON でない JSON-LD は例外",
    (() => {
      try {
        parseJsonLdScripts('<script type="application/ld+json">{x</script>');
        return "通った";
      } catch {
        return "例外";
      }
    })(),
    "例外",
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    await scene2(s1);
    scene3();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・check・parseJsonLdScripts・jsonLdScriptText・renderVenueHtml・getLocaleT・escapeHtml・getTodayVenueBreadcrumbItems・getTopPageMeta・getTodayVenuePageMeta・toFaqPageLd・buildFaqItems・isAssistShown・t・call・SUCCESS_CC・headOf・expectedHead・venueLinks・alternatesOf・hasRawScript） */
export async function runBotPageFunctionScenes2(env) {
  ({ read, check, parseJsonLdScripts, jsonLdScriptText, renderVenueHtml, getLocaleT, escapeHtml, getTodayVenueBreadcrumbItems, getTopPageMeta, getTodayVenuePageMeta, toFaqPageLd, buildFaqItems, isAssistShown, t, call, SUCCESS_CC, headOf, expectedHead, venueLinks, alternatesOf, hasRawScript } = env);
  await scene4();
}
