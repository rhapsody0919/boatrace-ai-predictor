// kyoteibiyori.com/vup/ をスクレイピングして機能一覧をJSONで返す
export async function scrapeVupFeatures() {
  try {
    const response = await fetch("https://kyoteibiyori.com/vup/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();

    // section要素ごとに機能を抽出
    const sectionRegex = /<section>(.*?)<\/section>/gs;
    const features = [];
    let match;

    while ((match = sectionRegex.exec(html)) !== null) {
      const sectionHtml = match[1];

      // h2から機能名を抽出
      const h2Match = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(sectionHtml);
      const title = h2Match ? h2Match[1].trim().replace(/<[^>]+>/g, "") : "";

      // 日付を抽出（<p style="color:blue...>の中）
      const dateMatch =
        /<p[^>]*style="color:blue[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(
          sectionHtml,
        );
      const date = dateMatch ? dateMatch[1].trim() : "";

      // ul > liから説明を抽出
      const liMatch = /<li>([\s\S]*?)<\/li>/i.exec(sectionHtml);
      let description = "";
      if (liMatch) {
        description =
          liMatch[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 200) + "...";
      }

      // 画像URLを抽出
      const imgMatch = /src="(img\/[^"]+)"/i.exec(sectionHtml);
      const imageUrl = imgMatch
        ? "https://kyoteibiyori.com/vup/" + imgMatch[1]
        : "";

      if (title) {
        features.push({
          title,
          date,
          description,
          imageUrl,
          section: sectionHtml.substring(0, 500),
        });
      }
    }

    return features;
  } catch (error) {
    console.error("Scraping error:", error);
    return [];
  }
}

// CLIから直接実行された場合のみ出力する（analyze-vup-feature.js からの import 時は実行しない）
if (import.meta.url === `file://${process.argv[1]}`) {
  const features = await scrapeVupFeatures();
  console.log(JSON.stringify(features, null, 2));
}
