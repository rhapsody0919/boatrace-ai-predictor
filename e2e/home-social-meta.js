// 他ページからトップへ戻った後の OGP の期待（BOA-1316）。
// トップが自分の OGP を出す前（index.html の既定のまま・og:url なし）と後（BOA-1255。
// title・description・canonical に合わせる）のどちらでも通す。
// 直前のページの値（title・description・URL）が残っていれば、どちらの状態でも問題として返す。

// 離れる直前のページの title・description。戻った後に OGP へ残っていてはいけない値
export async function leftPageSocialValues(page) {
  return page.evaluate(() => [
    document.title,
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content") ?? "",
  ]);
}

// 戻った後の問題点を返す（空なら合格）。
// defaults: セレクタ -> index.html の既定値、leftPath: 直前のページのパス、
// leftValues: leftPageSocialValues の結果
export async function homeSocialProblems(
  page,
  defaults,
  leftPath,
  leftValues = [],
) {
  return page.evaluate(
    ({ defaults, leftPath, leftValues }) => {
      const contents = (selector) =>
        Array.from(document.querySelectorAll(selector)).map((el) =>
          el.getAttribute("content"),
        );
      const metaDescription = document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content");
      const problems = [];
      for (const [selector, fallback] of Object.entries(defaults)) {
        const values = contents(selector);
        if (values.length !== 1) {
          problems.push(`${selector}: ${values.length}件`);
          continue;
        }
        const allowed = selector.includes("title")
          ? [fallback, document.title]
          : selector.includes("description")
            ? [fallback, metaDescription]
            : [fallback];
        if (!allowed.includes(values[0])) {
          problems.push(
            `${selector}: 既定値でも現ページの値でもない (${values[0]})`,
          );
        }
        // 現ページの title・description 自体が前のページのまま残っていても見逃さない
        if (values[0] !== fallback && leftValues.includes(values[0])) {
          problems.push(
            `${selector}: 直前のページの値が残っている (${values[0]})`,
          );
        }
      }
      const ogUrls = contents('meta[property="og:url"]');
      if (ogUrls.length > 1) problems.push(`og:url: ${ogUrls.length}件`);
      if (ogUrls.length === 1) {
        const canonical = document
          .querySelector('link[rel="canonical"]')
          ?.getAttribute("href");
        if (ogUrls[0] !== canonical) {
          problems.push(
            `og:url が canonical と違う (${ogUrls[0]} / ${canonical})`,
          );
        }
        if (leftPath && ogUrls[0]?.includes(leftPath)) {
          problems.push(
            `og:url に直前のページの URL が残っている (${ogUrls[0]})`,
          );
        }
      }
      return problems;
    },
    { defaults, leftPath, leftValues },
  );
}
