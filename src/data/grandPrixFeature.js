/**
 * グランプリの特集（/grandprix、ja 専用、BOA-1724）の中身。
 *
 * 年なしの永続の URL に毎年積む（seo-marketer 審査 2026-11-27）。来年は EDITION・DAYS・FLOW を差し替え、
 * 今年の優勝戦を PAST_FINALS の先頭に足す。
 * 出典（2026-11-27 に確認）:
 * - 日程: BOAT RACE 公式 https://www.boatrace.jp/owpc/pc/race/gradesch?year=2026
 * - 勝ち上がり: 大村の特設 https://omurakyotei.jp/special/2026grandprix/road-to-final/ の図
 * - 過去の優勝戦: 2021〜2023 は https://www.boatrace-grandprix.jp/<年>/rtg/roadto.php?pid=3&day=46 、
 *   2024・2025 と3連単は公式の結果 https://www.boatrace.jp/owpc/pc/race/raceresult?rno=12&jcd=<場>&hd=<日付>
 */

export const EDITION = Object.freeze({
  year: 2026,
  venueCode: 24,
  venueName: "大村",
  startDate: "2026-12-15",
  endDate: "2026-12-20",
  shortDates: "12/15〜20",
  longDates: "12月15日（火）〜20日（日）",
  roadToFinalUrl: "https://omurakyotei.jp/special/2026grandprix/road-to-final/",
  scheduleUrl: "https://www.boatrace.jp/owpc/pc/race/gradesch?year=2026",
});

/** 6日間の流れ（グランプリの側。シリーズの番組は載せない） */
export const DAYS = Object.freeze([
  { date: "12/15（火）", label: "初日", stage: "トライアル1st", body: "獲得賞金7〜18位の12人が第11R・第12Rに分かれて走る" },
  { date: "12/16（水）", label: "2日目", stage: "トライアル1st", body: "前日の着順でA組・B組に分かれて第11R・第12R（枠番は抽選）。得点率1〜6位の6人がトライアル2ndへ" },
  { date: "12/17（木）", label: "3日目", stage: "トライアル2nd", body: "獲得賞金1〜6位の6人が登場。1〜3号艇は2ndから出る選手、4〜6号艇は1stを勝ち抜いた選手" },
  { date: "12/18（金）", label: "4日目", stage: "トライアル2nd", body: "前日の着順でA組・B組に分かれて第11R・第12R（枠番は抽選）" },
  { date: "12/19（土）", label: "5日目", stage: "トライアル2nd", body: "前日の着順でA組・B組に分かれて第11R・第12R（枠番は抽選）。得点率1〜6位の6人が優勝戦へ" },
  { date: "12/20（日）", label: "最終日", stage: "優勝戦", body: "第12Rが優勝戦。枠番はトライアル2ndの得点率の順（1位が1号艇）。2ndの得点率7〜12位は第10Rの順位決定戦" },
]);

/**
 * 勝ち上がりの図の段。dots は [人数, 組]（組: "2nd" 賞金1〜6位の組・"1st" 1stから出る組・"out" 抜ける組）。
 * finalLanes が true の段は、点の代わりに1〜6号艇の色の丸を出す
 */
export const FLOW = Object.freeze([
  { when: "出場", name: "18人", lines: [{ dots: [[6, "2nd"]], text: "賞金1〜6位 → 2ndから" }, { dots: [[12, "1st"]], text: "7〜18位 → 1stから" }] },
  { when: "12/15〜16", name: "トライアル1st 12人", lines: [{ dots: [[6, "1st"]], text: "得点率1〜6位 → 2ndへ" }, { dots: [[6, "out"]], text: "7〜12位 → シリーズへ合流" }] },
  { when: "12/17〜19", name: "トライアル2nd 12人", lines: [{ dots: [[6, "2nd"], [6, "1st"]], text: "賞金1〜6位＋1stの勝ち抜け" }, { dots: [[6, "2nd"]], text: "得点率1〜6位 → 優勝戦へ" }, { dots: [[6, "out"]], text: "7〜12位 → 12/20 第10R 順位決定戦" }] },
  { when: "12/20 第12R", name: "優勝戦 6人", finalLanes: true, lines: [{ dots: [], text: "枠番は2ndの得点率の順（1位が1号艇）" }] },
]);

/** 過去の優勝戦（新しい順）。entry は進入のコース（公式の結果に列が無い年は null）、trifecta は3連単（不成立は null） */
export const PAST_FINALS = Object.freeze([
  { year: 2025, venue: "住之江", date: "12/21", winner: "桐生順平", lane: 1, entry: null, technique: "逃げ", trifecta: [1, 2, 5], payout: 760, popularity: 1 },
  { year: 2024, venue: "住之江", date: "12/22", winner: "毒島誠", lane: 1, entry: null, technique: "逃げ", trifecta: [1, 2, 3], payout: 1170, popularity: 3 },
  { year: 2023, venue: "住之江", date: "12/24", winner: "石野貴之", lane: 1, entry: 1, technique: "逃げ", trifecta: [1, 3, 4], payout: 1160, popularity: 2 },
  { year: 2022, venue: "大村", date: "12/18", winner: "白井英治", lane: 1, entry: 1, technique: "逃げ", trifecta: [1, 6, 4], payout: 6530, popularity: 21 },
  { year: 2021, venue: "住之江", date: "12/19", winner: "瓜生正義", lane: 4, entry: 3, technique: "まくり", trifecta: null, payout: null, popularity: null },
]);

/** よくある質問。答えは本文と同じ事実だけで書く（FAQPage の JSON-LD にも使う） */
export const FAQ = Object.freeze([
  {
    q: "2026年のグランプリはいつ、どこで開かれますか？",
    a: "2026年12月15日（火）〜20日（日）に、大村で開かれます。同じ期間・同じ会場で、グランプリシリーズも開かれます。",
  },
  {
    q: "グランプリには誰が出場できますか？",
    a: "年間の獲得賞金の上位18人です。7〜18位の12人はトライアル1stから、1〜6位の6人はトライアル2ndから出場します。出場する選手は公式の発表で確認してください。",
  },
  {
    q: "優勝戦の枠番はどう決まりますか？",
    a: "トライアル2ndの得点率の順です。得点率1位の選手が1号艇、6位の選手が6号艇に入ります。",
  },
  {
    q: "グランプリシリーズとは何ですか？",
    a: "グランプリと同じ期間に大村で開かれる大会です。トライアル1stの得点率7〜12位の6人は、シリーズの予選3日目から合流します。",
  },
  {
    q: "龍神レーダーの節のページでグランプリの得点率は見られますか？",
    a: "見られません。グランプリはトライアルとシリーズが同じ期間に開かれ、勝ち上がりの方式が違うため、節のページの対象外です。その日のレースは大村の会場ページで見られます。",
  },
]);
