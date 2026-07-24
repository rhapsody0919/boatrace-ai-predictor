/**
 * ZhTwVenueGuide - 会場別繁体字ガイド（/zh-TW/venues, /zh-TW/venues/:slug）
 * 台湾・香港の観光クエリ（交通・門票・初心者向け）の受け皿 + AI予想への導線（BOA-134）
 * JSX構造は VenueGuide.jsx に共通化済み。ここでは繁体字の文言のみを保持する
 */
import { Link } from "react-router-dom";
import { VenueGuideList, VenueGuideDetail } from "./VenueGuide";
import { VENUE_GUIDES_ZH_TW } from "../data/venueGuidesZhTw";

const copy = {
  listTitle: "日本賽艇（Kyotei）景點導覽：交通與門票資訊 | BoatAI",
  listDescription:
    "日本賽艇（BOAT RACE／Kyotei）賽場旅遊指南：交通方式、入場費、夜間賽事與投注小技巧，涵蓋平和島、住之江、江戶川、多摩川與福岡賽場。",
  heroTitle: "🏟️ 賽艇賽場旅遊指南",
  heroLead: (
    <>
      日本全國共有24座賽艇場，大多數只要¥100入場費就能參觀。以下指南整理了旅客最容易抵達的賽場——包括交通方式、各賽場的特色，以及第一次到場觀賽的玩法。還不熟悉這項運動？歡迎先閱讀我們的{" "}
      <Link to="/zh-TW/guide">新手入門指南</Link>。
    </>
  ),
  nightRaceBadge: "🌙 夜間賽事",
  ctaHeading: "出發前，先看看今日的AI預測",
  ctaButton: "🏁 查看今日免費預測",
  backToAll: "← 返回賽場列表",
  detailTitle: (venue) =>
    `${venue.name}賽艇場交通與參觀指南（${venue.kanji}）| BoatAI`,
  detailDescription: (venue) =>
    `前往${venue.region}${venue.name}賽艇場的方法：從最近車站的交通方式、入場費、水面特性與投注小技巧。${venue.tagline}。`,
  detailHeading: (venue) => (
    <>
      🚤 {venue.name}賽艇場 <span className="eg-kanji">{venue.kanji}</span>
    </>
  ),
  whyVisit: "為什麼值得一遊",
  gettingThere: "🚉 交通方式",
  entranceNote:
    "入場費：¥100（大多數賽場）。免費接駁巴士僅在賽事日行駛——實際發車時間請查詢賽場官方網站。",
  quickFacts: "⚡ 賽場快覽",
  factLabels: {
    water: "水質",
    character: "賽事風格",
    nightRace: "夜間賽事",
    entrance: "入場費",
  },
  nightRaceYes: "有 🌙",
  nightRaceNo: "無（僅日間賽事）",
  bettingTip: "💡 投注小技巧",
  beforeYouBet: "⚖️ 投注前須知",
  disclaimer: (
    <>
      投注日本賽艇僅限透過日本官方管道，且必須人在日本境內並年滿20歲。BoatAI僅提供資訊與AI分析——投注規則與券種請參閱我們的{" "}
      <Link to="/zh-TW/guide">新手入門指南</Link>。
    </>
  ),
  seeTodaysPredictions: (venue) =>
    `查看今日的AI預測${venue.facts.nightRace ? "（含夜間賽事）" : ""}`,
};

export function ZhTwVenueGuides() {
  return (
    <VenueGuideList lang="zh-TW" guides={VENUE_GUIDES_ZH_TW} copy={copy} />
  );
}

export default function ZhTwVenueGuide() {
  return (
    <VenueGuideDetail lang="zh-TW" guides={VENUE_GUIDES_ZH_TW} copy={copy} />
  );
}
