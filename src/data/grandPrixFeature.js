/**
 * グランプリの特集（/grandprix、ja 専用、BOA-1724）の中身。
 *
 * 年なしの永続の URL に毎年積む（seo-marketer 審査 2026-11-27）。来年は EDITION を差し替える。
 * 出典（2026-11-27 に確認）:
 * - 日程: BOAT RACE 公式 https://www.boatrace.jp/owpc/pc/race/gradesch?year=2026
 * - 勝ち上がり: 大村の特設 https://omurakyotei.jp/special/2026grandprix/road-to-final/ の図
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
