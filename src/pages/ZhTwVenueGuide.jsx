/**
 * ZhTwVenueGuide - 会場別繁体字ガイド（/zh-TW/venues, /zh-TW/venues/:slug）
 * 台湾・香港の観光クエリ（交通・門票・初心者向け）の受け皿 + AI予想への導線（BOA-134）
 * JSX構造は VenueGuide.jsx に共通化済み。ここでは繁体字の文言のみを保持する
 */
import { Link } from "react-router-dom";
import { VenueGuideList, VenueGuideDetail } from "./VenueGuide";
import { VenueRegionHub } from "./VenueRegionHub";
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
  scheduleHeading: "📅 賽期資訊",
  nearbyAttractionsHeading: "🗺️ 周邊景點",
  officialSiteLabel: "官方網站 →",
  mapHeading: "賽艇場地圖",
  multiMapLabel: "🗺️ 周邊景點位置圖（含賽場）",
  googleMapLabel: "📍 Google地圖（賽場位置，可直接開啟導航）",
  scheduleOfficialLabel: "查看官方完整賽程 →",
  videoLabel: "📺 官方YouTube頻道看比賽花絮 →",
  raceVideoHeading: "🎬 一起感受賽艇的魅力",
  raceVideoNote:
    "影片來自BOATRACE官方YouTube頻道，持續更新最新賽事精華，還沒看過比賽的話可以先感受一下現場氛圍。",
  languageBarrierHeading: "🌐 不會日文也能下注嗎？",
  languageBarrierBody: [
    "可以。只要年滿20歲，不分國籍都能合法在日本賽艇場下注。現場投注是透過填寫「馬克卡」（類似樂透彩券的表格），用鉛筆圈選賽事編號、投注方式、艇號與金額，主要靠圈選數字完成，語言門檻比想像中低。",
    "每張券最低¥100即可購買。部分賽場設有英文標示或可使用手機翻譯協助操作，但並非所有賽場都有專人英語服務，建議先查看官方英語指南做好準備。",
    "須注意：線上投注僅限持有日本銀行帳戶與地址的用戶使用，旅客只能在賽場現場親自購買。另外，日本賽艇場目前不支援信用卡、PayPay等一般電子支付投注，需使用各賽場自己發行的專用預付卡（詳見下方付款方式說明）。",
  ],
  languageBarrierLinkLabel: "查看BOATRACE官方英語指南 →",
  cashlessHeading: "💳 這裡的付款方式",
  cashlessLinkLabel: "查看官方付款方式說明 →",
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
  regionTitle: (region) =>
    `${region.labelZhTw}賽艇場旅遊指南：交通與門票資訊 | BoatAI`,
  regionDescription: (region) =>
    `日本${region.labelZhTw}賽艇（Kyotei）賽場旅遊指南：交通方式、入場費與投注小技巧。`,
  regionHeading: (region) => `🏟️ ${region.labelZhTw}賽艇賽場旅遊指南`,
  regionLabel: (region) => region.labelZhTw,
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

export function ZhTwVenueRegionHub() {
  return (
    <VenueRegionHub lang="zh-TW" guides={VENUE_GUIDES_ZH_TW} copy={copy} />
  );
}
