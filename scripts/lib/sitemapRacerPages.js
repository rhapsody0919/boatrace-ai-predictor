// generate-sitemap.js の getRacerPages から字のまま移した、選手1人の sitemap の行の組み立て（載せる判定は isRacerIndexable）。DB には触らない
import { isRacerIndexable } from "../../src/utils/racerIndexPolicy.js";

/**
 * 載せる選手なら sitemap の行と「ニュース掲載か」を返す。載せない選手は null
 * @returns {{ page: {loc: string, lastmod: string, changefreq: string, priority: string}, hasNews: boolean } | null}
 */
export function racerSitemapEntry(racerId, newsDateByRacerId, latestByRacerId, activeSince) {
  const latest = latestByRacerId.get(racerId);
  const latestRaceDate = latest ? latest.race_id.slice(0, 10) : null;
  const hasNews = newsDateByRacerId.has(racerId);
  if (
    !isRacerIndexable({
      hasNews,
      latestGrade: latest?.grade ?? null,
      latestRaceDate,
      activeSince,
    })
  ) {
    return null;
  }
  const lastmod = [newsDateByRacerId.get(racerId), latestRaceDate]
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    page: {
      loc: `/racer/${racerId}`,
      lastmod,
      changefreq: "weekly",
      priority: "0.5",
    },
    hasNews,
  };
}
