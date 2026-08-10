/**
 * 繁体字中国語版 会場ガイドのコンテンツデータ（BOA-134）
 * 台湾・香港の観光クエリ向けコンテンツ。英語版（venueGuidesEn.js）と同じ5会場を対象に翻訳・現地化
 * scripts/generate-sitemap.js（node 直実行）からも import されるため、Vite 専用構文を使わず純粋な JS データに保つこと
 *
 * name: 繁体字の会場名（一次表示）、kanji: ローマ字表記（実際の駅名・案内表示との対照用の補助表記）
 */

export const VENUE_GUIDES_ZH_TW = [
  {
    slug: "heiwajima",
    code: 4,
    name: "平和島",
    kanji: "Heiwajima",
    region: "東京",
    tagline: "距羽田機場僅數分鐘——對旅客最友善的賽場",
    intro: [
      "平和島賽艇場位於東京都大田區的「BIG FUN平和島」娛樂複合設施內——內有保齡球館、遊樂場、餐廳，隔壁還有天然溫泉。如果你正在東京旅遊，或搭乘羽田機場班機前後有多餘時間，這裡是初次體驗賽艇最輕鬆的賽場。",
      "平和島在投注者間也以「1號艇最難獲勝」聞名日本。第一個彎道又急又窄，逃走（領先艇維持第一）失敗的機率高於平均，因此爆冷與高配當屢見不鮮——是了解賽場特性對賽艇預測有多重要的最佳範例。",
    ],
    access: [
      "京急線「平和島」站 → 免費接駁巴士（或步行約15-20分鐘）",
      "JR京濱東北線「大森」站（東口）→ 賽事日免費接駁巴士",
      "從羽田機場出發：搭乘京急線約20-30分鐘",
    ],
    mapQuery: "ボートレース平和島",
    lat: 35.586035,
    lng: 139.740333,
    videoUrl: "https://www.youtube.com/@tokyobaytv9067",
    cashless: {
      note: "本場（賽艇場本身）僅收現金，沒有信用卡或投注專用預付卡。若想使用電子支付投注，需前往緊鄰的場外發售所「平和島劇場」，該處提供專用預付卡「P★CARD」。",
      url: "https://www.heiwajima.gr.jp/sp/cashless/cashless.htm",
    },
    image: {
      src: "/images/venues/heiwajima.jpg",
      alt: "平和島賽艇場",
      credit: "Photo by cake6, CC BY 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Heiwajima-kyotei-01.jpg",
    },
    facts: {
      water: "海水（受潮汐影響）",
      character: "1號艇容易落敗——爆冷與高配當常見",
      nightRace: false,
    },
    tip: "下注前先查看我們預測頁面上的「1號艇爆冷指數」——平和島正是這項數據最能發揮作用的賽場。",
    nearbyAttractions: [
      {
        name: "天然溫泉平和島",
        description:
          "就在賽場所在的「BIG FUN平和島」娛樂複合設施內，24小時營業，源自地下2000公尺湧出的天然溫泉，鈉強鹽泉與高濃度碳酸泉是招牌，另設岩盤浴與按摩服務，賽前賽後都能順道泡湯放鬆。",
        url: "https://www.heiwajima-onsen.jp/",
      },
      {
        name: "跳跳平和島（トンデミ平和島）",
        description:
          "同樣位於BIG FUN平和島內的室內運動樂園，有蹦床、攀岩牆與繩索課程，適合帶小孩的家庭，可以和賽艇、溫泉排在同一趟行程。",
      },
      {
        name: "しながわ水族館",
        description:
          "東京都內的中型水族館，海豚秀、海獅秀與360度全景水槽的海豹館最受歡迎，位於大森海岸站附近的しながわ區民公園內，從賽場搭電車約10分鐘可達。",
        lat: 35.58763655,
        lng: 139.73533342,
      },
      {
        name: "大森故鄉海濱公園",
        description:
          "東京23區內少見保留天然沙灘與潮間帶的區立公園，可以赤腳踏浪、觀察招潮蟹等潮間帶生物，園內的「大森海苔故鄉館」還有可以眺望東京灣的展望台，從賽場步行約15分鐘可達。",
        lat: 35.57302718,
        lng: 139.74220282,
      },
      {
        name: "羽田機場",
        description:
          "日本主要國際機場之一，搭京急線約20-30分鐘可達，第三航廈的江戶小路重現江戶時代街景並附設免稅店，適合安排在航班前後順道觀賽或返程前的最後行程。",
        lat: 35.544982,
        lng: 139.769184,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "suminoe",
    code: 12,
    name: "住之江",
    kanji: "Suminoe",
    region: "大阪",
    tagline: "賽艇的「聖地」——在大阪市中心觀賞夜間賽事",
    intro: [
      "大阪的住之江賽艇場素有「賽艇聖地」之稱，經常舉辦賽艇界最重要的錦標賽，並設有夜間賽事（約下午2:30至晚上9:00），讓你白天在大阪觀光、晚上仍能在燈光下欣賞完整賽事。",
      "賽場距地鐵站步行僅需片刻，是日本交通最方便的賽場之一。看台美食、燈火通明的水面與頂尖選手，讓住之江成為若只想在關西看一場賽艇，最值得造訪的賽場。",
    ],
    access: [
      "大阪地下鐵四橋線「住之江公園」站（2號出口）→ 步行約3分鐘",
      "從難波出發：搭乘地下鐵約15分鐘",
    ],
    mapQuery: "ボートレース住之江",
    lat: 34.61166795,
    lng: 135.47127343,
    videoUrl: "https://www.youtube.com/channel/UCW3AReETO-oDmEoE-m3i7dQ",
    cashless: {
      note: "現場沒有信用卡收單，僅能用現金或會場發行的投注專用預付卡「JUMPY CARD+」，需先加值才能投注，入場閘門也可用這張卡感應通過。",
      url: "https://www.boatrace-suminoe.jp/sp/cashless.html",
    },
    image: {
      src: "/images/venues/suminoe.jpg",
      alt: "住之江賽艇場看台",
      credit: "Photo by MASA, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Suminoe_Kyotei2.jpg",
    },
    facts: {
      water: "淡水（人工水池）",
      character: "賽事風格均衡；經常舉辦SG/G1等級最高賽事",
      nightRace: true,
    },
    tip: "夜間賽事讓你能白天遊大阪、晚上看賽艇——別忘了查看我們針對夜間賽程的預測。",
    nearbyAttractions: [
      {
        name: "住吉大社",
        description:
          "日本最古老、最重要的神社之一，主祭海上守護神，每年新年參拜人數在關西名列前茅。境內的太鼓橋（反橋）是知名地標，從賽場搭地下鐵轉乘約20分鐘可達，適合安排在賽事前的半天行程。",
        url: "https://www.sumiyoshitaisha.net/",
        lat: 34.613379,
        lng: 135.493023,
      },
      {
        name: "ATC（亞太貿易中心）與住之江溫泉SPA",
        description:
          "賽場往西約6公里的大型複合商場，內有暢貨中心、家居賣場與海景餐廳，適合逛街購物。緊鄰住之江公園站的住之江溫泉SPA則是在地人賽後泡湯放鬆的熱門去處，兩者可安排在同一趟行程。",
        lat: 34.6378236,
        lng: 135.41157189,
      },
      {
        name: "難波、心齋橋",
        description:
          "大阪最大的購物與美食商圈，心齋橋筋商店街、道頓堀周邊林立百貨公司與傳統小吃店，從賽場搭地下鐵約15分鐘可達，晚間賽事結束後可以直接安排逛街吃飯的行程。",
        lat: 34.666438,
        lng: 135.495265,
      },
      {
        name: "道頓堀",
        description:
          "大阪最具代表性的觀光地標，固力果跑跑人看板、螃蟹道樂等巨大招牌沿著道頓堀川一字排開，章魚燒、大阪燒、串炸等大阪代表美食都能在這裡吃到，緊鄰難波、心齋橋，適合排在同一段路線。",
        lat: 34.668516,
        lng: 135.502552,
      },
      {
        name: "通天閣・新世界",
        description:
          "大阪的地標塔通天閣與周邊的新世界懷舊街區，串炸店與昭和復古氛圍的招牌林立，是感受大阪下町人情味的代表景點。從難波搭地下鐵約10分鐘可達，適合排在道頓堀之後的行程。",
        url: "https://www.tsutenkaku.co.jp/",
        lat: 34.650935,
        lng: 135.505724,
      },
    ],
    schedule: {
      typicalRaceDays:
        "每年固定舉辦多次例行賽，每次約4至7天，另有定期的多日SG／G1大賽。",
      seasonalNotes:
        "多數年份的12月會舉辦賽季總決賽SG大獎賽（グランプリ），是賽艇界年度最盛大的賽事之一。",
    },
  },
  {
    slug: "edogawa",
    code: 3,
    name: "江戶川",
    kanji: "Edogawa",
    region: "東京",
    tagline: "日本唯一的天然河川賽道——狂野水域、狂野配當",
    intro: [
      "位於東京東部的江戶川賽艇場，是日本唯一建於天然河川上的賽場。風向與潮汐不斷改變水面狀況，使其成為賽艇界最難預測的賽道——這裡的比賽以爆冷聞名。",
      "對觀眾而言，這裡是最原始的賽艇體驗：波濤洶湧的水面、與水流搏鬥的賽艇，以及可能爆出的驚人配當。如果你喜歡混亂刺激的比賽，江戶川就是你的賽場。",
    ],
    access: [
      "都營新宿線「船堀」站 → 賽事日免費接駁巴士",
      "JR總武線「平井」站 → 賽事日免費接駁巴士",
    ],
    mapQuery: "ボートレース江戸川",
    lat: 35.69223896,
    lng: 139.86135473,
    videoUrl: "https://www.youtube.com/channel/UCpNAwETM_vPV2Skumzc_KMA",
    cashless: {
      note: "現場沒有信用卡收單，僅能用現金或會場發行的投注專用預付卡「Eメンバー」，投注每100日圓可獲得1.5倍點數（1.5pt），點數可兌換場內利用券、指定席券或禮品卡。",
      url: "https://edogawa-emember.com/",
    },
    image: {
      src: "/images/venues/edogawa.jpg",
      alt: "江戶川賽艇場",
      credit: "Photo by 博柳, CC BY 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:%E6%B1%9F%E6%88%B8%E5%B7%9D%E7%AB%B6%E8%89%87%E5%A0%B4_-_panoramio.jpg",
    },
    facts: {
      water: "河川（受潮汐、風向與水流影響）",
      character: "日本水面最不穩定的賽場——預期會有爆冷",
      nightRace: false,
    },
    tip: "這裡的天氣影響比其他任何賽場都更大。我們的AI會將賽場的不穩定性納入每一場江戶川預測。",
    nearbyAttractions: [
      {
        name: "鬼太郎小路（場內）",
        description:
          "賽場自己的堤防看台上，掛滿了《鬼太郎》作者水木茂的妖怪畫作，是全日本賽艇場中獨一無二的場內景點，看比賽之餘也能順道欣賞這些懷舊插畫。",
      },
      {
        name: "葛西臨海公園・水族園",
        description:
          "擁有大型甜甜圈形水槽、可觀賞成群黑鮪魚洄游的水族園，以及能眺望東京灣的大摩天輪，從賽場搭電車約30分鐘可達，往東京迪士尼度假區方向也只有一站之隔。",
        lat: 35.64442524,
        lng: 139.86156763,
      },
      {
        name: "TOWER HALL船堀",
        description:
          "江戶川區的地標展望塔，115公尺高的展望台免費開放，天氣好時可遠眺東京晴空塔與富士山，就在船堀站旁，是賽前賽後順道眺望東京全景的好去處。",
        url: "https://www.towerhall.jp/",
        lat: 35.684378,
        lng: 139.86496,
      },
      {
        name: "行船公園・自然動物園",
        description:
          "免費入園的迷你動物園，可近距離觀察紅鶴、狐獴、水豚等62種小動物，園內還有日式庭園「平成庭園」與釣魚池，從西葛西站步行約15分鐘，很適合親子行程。",
        lat: 35.671505,
        lng: 139.858263,
      },
      {
        name: "東京迪士尼度假區",
        description:
          "日本最具代表性的主題樂園，從葛西臨海公園再搭JR京葉線一站即達舞濱站，若賽事排在白天，晚上還能安排半天樂園行程。",
        lat: 35.63626,
        lng: 139.88361,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "tamagawa",
    code: 5,
    name: "多摩川",
    kanji: "Tamagawa",
    region: "東京（府中）",
    tagline: "日本最平穩的水面——純粹考驗選手實力",
    intro: [
      "位於東京西部的多摩川賽艇場，人稱「日本最平穩的水面」。防風林與看台為水池擋住風勢，因此比賽結果多由純粹的技術決定，較少受天候影響。",
      "賽場緊鄰同名車站——「競艇場前」站（此為當地實際站名），是少見以場館命名車站的例子。平穩的水面讓比賽結果相對容易判讀，很適合初次下注的旅客。",
    ],
    access: [
      "西武多摩川線「競艇場前」站 → 步行約3分鐘",
      "從JR「府中本町」站或京王線「多磨靈園」站搭乘賽事日免費接駁巴士",
    ],
    mapQuery: "ボートレース多摩川",
    lat: 35.658024,
    lng: 139.497068,
    videoUrl: "https://www.youtube.com/channel/UC4lvZQUptR8m5VDSu49xCGQ",
    cashless: {
      note: "現場沒有信用卡收單，可在指定席窗口或Wakey Park 2樓申請場內專用電子預付卡，事先加值後即可用於投注與入場，本場投注每100日圓可獲得1點，點數可兌換現金。",
      url: "https://www.boatrace-tamagawa.com/sp/index.php?page=service-cashless",
    },
    image: {
      src: "/images/venues/tamagawa.jpg",
      alt: "多摩川賽艇場",
      credit: "Photo by nakashi, CC BY-SA 2.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Boat_race_tamagawa_%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E5%A4%9A%E6%91%A9%E5%B7%9D_(48113070693).jpg",
    },
    facts: {
      water: "淡水（人工水池）",
      character: "水面非常平穩——技術導向，適合新手",
      nightRace: false,
    },
    tip: "穩定的水面條件讓選手與馬達數據更具參考價值——這正是我們AI在每場比賽中重點分析的資料。",
    nearbyAttractions: [
      {
        name: "東京競馬場",
        description:
          "JRA旗下規模最大的賽馬場之一，從多摩川賽艇場步行約14分鐘可達，是同一天內連續體驗兩種截然不同日本賽事文化的難得機會，賽馬日通常在週末。",
        lat: 35.662493,
        lng: 139.485571,
      },
      {
        name: "府中站・馬場大門欅並木",
        description:
          "府中站南口延伸約500公尺的欅樹林蔭大道，是東京都內少見的古樹並木道，四季皆有不同風情，周邊百貨與商店街也集中在此，賽事日有免費接駁巴士往返。",
        lat: 35.668992,
        lng: 139.477725,
      },
      {
        name: "大國魂神社",
        description:
          "武藏國總社，府中最重要的神社，每年5月的「くらやみ祭」是東京都內數一數二盛大的傳統祭典，境內古木參天，從府中站步行約5分鐘可達。",
        url: "https://www.ookunitamajinja.or.jp/",
        lat: 35.669633,
        lng: 139.479583,
      },
      {
        name: "府中市鄉土之森博物館",
        description:
          "佔地約14萬平方公尺的戶外博物館，園內保存多棟歷史建築、天文館與大型水景遊戲池，2至3月梅園盛開時尤其熱門，從賽場步行約20分鐘可達。",
        lat: 35.656734,
        lng: 139.473216,
      },
      {
        name: "SUNTORY武藏野啤酒工廠",
        description:
          "SUNTORY首座啤酒工廠，提供免費的釀造流程導覽與試飲行程（需事先預約），從府中本町站步行約15分鐘，適合對日本啤酒文化有興趣的旅客。",
        url: "https://www.suntory.co.jp/factory/musashino/",
        lat: 35.66641531,
        lng: 139.47706333,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "fukuoka",
    code: 22,
    name: "福岡",
    kanji: "Fukuoka",
    region: "福岡（九州）",
    tagline: "步行即達天神鬧區的賽場——以刁鑽水面聞名",
    intro: [
      "福岡賽艇場可能是日本地理位置最便利的賽場：座落於那珂川與博多灣交會處，距離福岡市中心天神地區僅約10分鐘步行路程。你可以從逛街吃拉麵，到現場看賽事，只需幾分鐘的轉換。",
      "河水與海水交會形成的特殊湧浪，讓第一彎道即使頂尖選手也感到棘手——熟悉在地水面特性與近期賽績格外重要。",
    ],
    access: [
      "從天神地下鐵站（東1a出口）向北步行約10分鐘",
      "從西鐵福岡（天神）站步行約15分鐘",
    ],
    mapQuery: "ボートレース福岡",
    lat: 33.599365,
    lng: 130.397081,
    videoUrl: "https://www.youtube.com/@boatracejpfukuoka",
    cashless: {
      note: "現場沒有信用卡收單，僅能用現金或會場自己發行的投注專用預付卡「ペラ坊卡」（Perabo Card），卡片內建樂天Edy功能，需先在場內儲值機加值後才能投注。",
      url: "https://www.boatrace-fukuoka.com/sp/index.php?page=service-perabo",
    },
    image: {
      src: "/images/venues/fukuoka.jpg",
      alt: "福岡賽艇場正門入口",
      credit: "Photo by STA3816, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Main_entrance_of_Boat_Race_Fukuoka.jpg",
    },
    facts: {
      water: "汽水（河海交會）——特殊湧浪",
      character: "第一彎道刁鑽；請密切留意展示航行表現",
      nightRace: false,
    },
    tip: "第一標附近的湧浪讓展示數據格外重要——我們的預測表會顯示每位選手的展示時間。",
    nearbyAttractions: [
      {
        name: "大濠公園",
        description:
          "福岡市中心少見的水景公園，中央是一座大湖，環湖步道全長約2公里，湖畔還有仿中國蘇州庭園打造的日本庭園（入園費用¥250，開放時間依季節為9:00-17:00或9:00-18:00，週一休園）。從天神搭地下鐵空港線約4分鐘、大濠公園站下車即達，很適合在賽前或賽後散步放鬆、感受福岡人日常生活的一面。",
        url: "https://www.ohorikouen.jp/",
        lat: 33.586182,
        lng: 130.376188,
      },
      {
        name: "舞鶴公園・福岡城跡",
        description:
          "與大濠公園相連的城跡公園，保留福岡城的石垣與瞭望台遺跡，春天是福岡數一數二的賞櫻名所。入園免費，從大濠公園步行過去即可，很適合和大濠公園排在同一段路線一起參觀，感受福岡從江戶時代到現代的城市變化。",
        lat: 33.586043,
        lng: 130.383178,
      },
      {
        name: "天神",
        description:
          "福岡最大的購物、美食與夜生活商圈，從賽場步行約15分鐘可達。百貨公司、地下街、居酒屋林立，晚間賽事結束後可以直接步行過來吃晚餐、逛街，不需要額外規劃交通。",
        lat: 33.591426,
        lng: 130.399002,
      },
      {
        name: "警固神社",
        description:
          "位於天神鬧區正中央的神社，1608年由福岡藩主黑田長政建立，逛街逛累了可以順道進去參拜、感受鬧市中的寧靜。緊鄰的警固公園也是市民休憩的熱門地點。",
        lat: 33.5877369,
        lng: 130.39996343,
      },
      {
        name: "中洲屋台街",
        description:
          "沿那珂川而設的路邊屋台（攤販）街，是福岡最具代表性的在地飲食文化，天氣好時每晚約18:00起陸續開張、營業至凌晨。拉麵、關東煮、串烤一應俱全，坐在屋台的吧檯前與老闆和鄰座閒聊，是外國旅客體驗「福岡在地生活感」最推薦的方式，晚間看完賽事後順道前往非常順路。",
        lat: 33.595235,
        lng: 130.402559,
      },
      {
        name: "櫛田神社",
        description:
          "博多的總鎮守，被暱稱為「お櫛田さん」，每年7月博多祇園山笠祭典的主舞台就在這裡，境內常年展示著色彩繽紛的山笠花車。從中洲步行約10分鐘可達，是感受博多（相對於天神）另一種傳統氛圍的代表景點。",
        lat: 33.5929546,
        lng: 130.4104589,
      },
      {
        name: "Canal City博多",
        description:
          "以運河造景聞名的大型購物商場，內有電影院、劇場與多間餐廳，緊鄰櫛田神社，晚上還有噴水音樂秀。從中洲屋台街步行約5分鐘可達，適合安排在屋台晚餐前後順道逛逛。",
        url: "https://canalcity.co.jp/",
        lat: 33.596269,
        lng: 130.410857,
      },
      {
        name: "場內美食與特別觀覽席「ROKU」",
        description:
          "賽場本身也是一個值得停留的景點：中央看台2樓的「ペラ坊饅頭」是招牌小吃，3樓餐廳的「穴子丼（星鰻蓋飯）」評價很高。場外還有獨立的特別觀覽設施「ROKU」，可以邊喝咖啡邊觀賽，並設有兒童遊戲區，適合親子或情侶悠閒度過一個下午。",
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes:
        "福岡近年也多次舉辦G1級別的全國性大賽，是九州地區規格較高的賽艇場之一，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "kiryu",
    code: 1,
    name: "桐生",
    kanji: "Kiryu",
    region: "群馬",
    tagline: "夜間競賽的發源地——日本海拔最高的賽艇場",
    intro: [
      "位於群馬縣的桐生賽艇場，是日本24座賽艇場中第一個引進夜間競賽的場館（1997年），如今每一場比賽都在夜間燈光下進行（首場約下午3點開始，末場約晚上8點半結束）。這裡同時也是日本海拔最高的賽艇場，位於海拔128公尺處。",
      "較稀薄的空氣讓馬達出力略低於海平面附近的賽場，因此比起純粹搶佔內側的「逃走」戰術，外側艇的衝刺戰術更容易奏效。冬季與春季常吹起當地人稱為「赤城颪」的強勁季節風，為賽況增添更多變數。",
    ],
    access: [
      "JR兩毛線「岩宿」站 → 步行約12分鐘，或搭乘免費接駁巴士",
      "賽事日「葉鹿」站也提供免費接駁巴士",
    ],
    mapQuery: "ボートレース桐生",
    lat: 36.39642168,
    lng: 139.30845653,
    videoUrl: "https://www.youtube.com/@boatracejpkiryu",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請免費的「DK Card」，可在場內機台加值，使用指定席購票時每100日圓可獲得1點。",
      url: "https://www.kiryu-kyotei.com/sp/index.php?page=about-question",
    },
    image: {
      src: "/images/venues/kiryu.jpg",
      alt: "桐生賽艇場",
      credit: "Photo by cake6, CC BY 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Kiryu-kyotei-01.jpg",
    },
    facts: {
      water: "淡水（人工水池）",
      character: "日本海拔最高賽艇場——較稀薄的空氣有利於衝刺型選手",
      nightRace: true,
    },
    tip: "這裡較低的氣壓悄悄改變了戰術平衡，讓外側衝刺型選手更容易發揮——我們的AI在每場桐生預測中都會納入海拔因素分析。",
    nearbyAttractions: [
      {
        name: "桐生新町紡織老街",
        description:
          "保存完整的歷史紡織街區，鋸齒狀屋頂的老工廠林立——桐生作為絲織重鎮已有400年歷史，街區南端的「有鄰館」倉庫群是此區的代表建築。",
        lat: 36.416606,
        lng: 139.34303,
      },
      {
        name: "桐生織物參考館",
        description:
          "介紹桐生紡織文化的博物館，館內展示可實際運作的織布機，就位於新町紡織街區內，適合和老街散步一起安排。",
      },
      {
        name: "桐生天滿宮",
        description:
          "約400年前桐生新町便是圍繞這座神社發展起來，至今仍是當地的信仰中心，每月25日左右會舉辦古董市集。",
        lat: 36.422137,
        lng: 139.34634,
      },
      {
        name: "桐生站周邊",
        description:
          "市內主要車站及周邊商店街，連接賽艇場與新町紡織街區及桐生市中心。",
        lat: 36.41102148,
        lng: 139.33332328,
      },
      {
        name: "桐生丘公園（動物園與遊樂園）",
        description:
          "免費入場的市立公園，結合小型動物園（長頸鹿、獅子、大象等）與遊樂設施，從桐生站步行約15分鐘，適合親子輕鬆同遊。",
      },
    ],
    schedule: {
      typicalRaceDays:
        "這裡的比賽全數在夜間舉行。每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "hamanako",
    code: 6,
    name: "濱名湖",
    kanji: "Hamanako",
    region: "靜岡",
    tagline: "日本最寬闊的賽道，坐落於以鰻魚聞名的鹹淡水湖畔",
    intro: [
      "濱名湖賽艇場位於靜岡縣濱名湖西岸，賽道寬度是日本24座賽艇場中最寬的。湖水為海水與淡水混合的鹹淡水湖，加上賽道格外寬闊，賽艇能加速衝到更高速度，因此外側艇的「捲切」（外側超車）戰術在這裡的成功率比狹窄賽場更高。",
      "每年3月至9月採夏季賽程，末場比賽會延後到接近黃昏時分、下午5點過後才結束，而非一般白天賽事的時段——如果想同時安排賽艇觀戰與傍晚的湖畔行程，這個時段很值得留意。",
    ],
    access: [
      "JR東海道本線「新居町」站 → 步行約5分鐘",
      "自駕：距濱松西、三日、館山寺智慧型交流道約30分鐘車程",
    ],
    mapQuery: "ボートレース浜名湖",
    lat: 34.698504,
    lng: 137.57206,
    videoUrl: "https://www.youtube.com/channel/UCGZig6i5JrZ33jjW2GG6Bzw",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請免費的「Hamana Po!」IC卡，可在場內機台加值，每100日圓投注可獲得1點，點數可兌換現金或場館周邊商品。",
      url: "https://www.boatrace-hamanako.jp/sp/index.php?page=service-point",
    },
    image: {
      src: "/images/venues/hamanako.jpg",
      alt: "濱名湖賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Hamanako-kyotei-01.jpg",
    },
    facts: {
      water: "鹹淡水（湖水，海水與淡水混合）——日本最寬賽道",
      character: "水面流速快，外側艇超車機會多",
      nightRace: false,
    },
    tip: "格外寬闊的賽道比其他賽場更有利於外側衝刺型選手——我們的AI在每場濱名湖預測中都會納入這項因素。",
    nearbyAttractions: [
      {
        name: "館山寺溫泉",
        description:
          "位於湖東岸的溫泉度假小鎮，以鰻魚料理與可眺望湖景的溫泉旅館聞名，從賽場開車約40分鐘，位於濱名湖對岸。",
        lat: 34.763229,
        lng: 137.615619,
      },
      {
        name: "濱名湖Pal Pal遊樂園",
        description:
          "就在館山寺溫泉區內的湖畔遊樂園，設有約25項遊樂設施，是廣受歡迎的親子同遊景點，可以和溫泉行程一起安排。",
        lat: 34.763229,
        lng: 137.615619,
      },
      {
        name: "濱名湖花園公園",
        description:
          "湖泊南岸的大型縣立公園，園內有花卉庭園與寬廣草坪，曾是全國花卉博覽會的舉辦場地，從賽場開車約15分鐘可達。",
        lat: 34.714473,
        lng: 137.600915,
      },
      {
        name: "新居關所（新居宿關卡遺跡）",
        description:
          "日本唯一保存至今的江戶時代舊東海道關卡建築，現已改為博物館，與賽場同樣位於新居地區，交通十分方便。",
        lat: 34.694906,
        lng: 137.561779,
      },
      {
        name: "濱松花卉公園",
        description:
          "大型花卉主題樂園，全年皆有應季花卉展示，位於濱名湖花園公園以北約12分鐘車程處。",
      },
    ],
    schedule: {
      typicalRaceDays:
        "每年固定舉辦多次例行賽，每次約4至7天。3月至9月採夏季賽程，末場比賽時間會略為延後。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "gamagori",
    code: 7,
    name: "蒲郡",
    kanji: "Gamagori",
    region: "愛知",
    tagline: "面向三河灣的快速平穩賽道，日本少數的夜間競賽場之一",
    intro: [
      "蒲郡賽艇場位於愛知縣三河灣畔，第一標附近的直道是全國最寬的賽道之一。水面平穩且流速快，加上有屏障阻擋強風，因此賽事節奏快、1號艇奪冠率高——但中央水道的超車戰術仍然時常成功，第二標常有精彩逆轉。",
      "蒲郡也是少數採夜間競賽的賽艇場之一，水面在探照燈下閃閃發光，氛圍與白天賽事截然不同，是特別值得體驗的一點。",
    ],
    access: [
      "JR東海道本線「三河塩津」站 → 步行約5分鐘",
      "名鐵蒲郡線「蒲郡競艇場前」站，或從JR蒲郡站搭乘每30分鐘一班的直達巴士",
    ],
    mapQuery: "ボートレース蒲郡",
    lat: 34.82390294,
    lng: 137.20574497,
    videoUrl: "https://www.youtube.com/channel/UCZhuyNQgLORLjgl8hlA7uHw",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可在1樓服務台申請免費的「e-jan Card」，投注、入場或指定席消費每100日圓可獲得1點，點數可兌換現金或商品，持卡者也能透過免費手機App下注。",
      url: "https://gama-win.com/card/about/index.html",
    },
    image: {
      src: "/images/venues/gamagori.jpg",
      alt: "蒲郡賽艇場正門",
      credit: "Photo by A301m089, public domain, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:20080719_Gamagori_kyotei_Central_Gate.jpg",
    },
    facts: {
      water: "淡水人工水池——平穩快速，有屏障阻擋強風",
      character: "1號艇奪冠率高，但第二標中央水道逆轉也很常見",
      nightRace: true,
    },
    tip: "平穩快速的水面讓乾淨的起跑更加關鍵——我們的AI在每場蒲郡預測中都會重點分析起跑時間數據。",
    nearbyAttractions: [
      {
        name: "竹島與八百富神社",
        description:
          "蒲郡的地標——透過一座387公尺長的橋樑連接的小型聖島，島上供奉八百富神社，是日本七大辯天神社之一。竹島本身因獨特的植物生態被指定為天然紀念物。",
        lat: 34.811002,
        lng: 137.231683,
      },
      {
        name: "竹島水族館",
        description:
          "就在竹島旁的小型特色水族館，以展示珍奇深海生物聞名，同時也有常見的人氣海洋生物。",
        lat: 34.811002,
        lng: 137.2325,
      },
      {
        name: "Laguna Ten Bosch",
        description:
          "濱海度假區，內有主題樂園、outlet購物中心與餐飲設施，從JR蒲郡站搭乘免費接駁巴士約15分鐘可達。",
        lat: 34.808775,
        lng: 137.271339,
      },
      {
        name: "三谷溫泉",
        description:
          "位於三河灣畔的溫泉區，罕見地在同一小範圍內擁有四種不同泉質的溫泉，適合賽事前後放鬆一下。",
      },
      {
        name: "蒲郡經典飯店",
        description:
          "戰前興建的西式飯店，位於竹島對岸的山丘上，即使不住宿也值得一看，以懷舊建築與海景聞名。",
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "tokoname",
    code: 8,
    name: "常滑",
    kanji: "Tokoname",
    region: "愛知",
    tagline: "隔海遙望中部國際機場，起航區考驗選手技術",
    intro: [
      "常滑賽艇場座落於愛知縣，隔著海灣正對中部國際機場（Centrair），是日本少數能輕鬆安排「賽艇＋航班」行程的賽場之一。賽艇出發前停靠的起航區（Pit）比大多數賽場更長，讓選手要抓準出航時機變得更加困難。",
      "常滑同時也是歷史悠久的燒物（陶瓷）產地，賽事日安排一趟陶藝老街散步，可以說是理所當然的行程搭配。",
    ],
    access: [
      "名鐵常滑線「常滑」站 → 步行約5分鐘",
      "從中部國際機場出發：搭電車約5分鐘至常滑站，再步行約5分鐘",
    ],
    mapQuery: "ボートレースとこなめ",
    lat: 34.88566429,
    lng: 136.8324971,
    videoUrl: "https://www.youtube.com/channel/UCu9lPbAk1MosTGm2yQ4BapQ",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請免費的「TOKOCA」卡，當天申請當天即可使用，每200日圓投注可獲得1點，點數可折抵購票或入場費用。",
      url: "https://tokoname-mania.com/card/",
    },
    image: {
      src: "/images/venues/tokoname.jpg",
      alt: "常滑賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Tokoname-kyotei-01.jpg",
    },
    facts: {
      water: "海水人工水池（有閘門阻隔，不受潮汐影響）",
      character: "起航區較長，出航時機掌握比其他賽場更困難",
      nightRace: false,
    },
    tip: "由於這裡的出航時機特別難以掌握，我們的AI在常滑預測中會特別加重起跑數據的分析權重。",
    nearbyAttractions: [
      {
        name: "燒物散步道（やきもの散歩道）",
        description:
          "歷史悠久的陶瓷老街，磚造煙囪與工藝工坊沿著約1.6公里的步道分佈，起點是常滑站步行約5分鐘可達的陶瓷博物館。",
        lat: 34.89056,
        lng: 136.83556,
      },
      {
        name: "常滑招財貓通り",
        description:
          "一面由當地陶藝家製作的39隻陶製招財貓組成的牆面，上方還有一隻高6.3公尺、名為「TOKONYAN」的巨型招財貓探頭俯瞰——常滑最熱門的拍照景點之一，就在前往陶瓷博物館的路上。",
        lat: 34.89056,
        lng: 136.83656,
      },
      {
        name: "INAX Live Museum",
        description:
          "介紹磁磚與陶瓷歷史的博物館園區，園內保留一座可實際走入內部參觀的磚造窯，很適合和陶藝老街散步安排在一起。",
      },
      {
        name: "中部國際機場（Centrair）",
        description:
          "就在賽場對岸的海灣另一側，賽前賽後安排航班十分方便，機場內還設有展望台，適合單純看飛機起降。",
        lat: 34.85833,
        lng: 136.80528,
      },
      {
        name: "臨空海岸",
        description:
          "就在賽場旁的白沙人工海灘，夏季相當熱門，以能眺望中部國際機場方向的夕陽美景聞名。",
        lat: 34.886178,
        lng: 136.822708,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "toda",
    code: 2,
    name: "戶田",
    kanji: "Toda",
    region: "埼玉",
    tagline: "日本最狹窄的賽道——唯一擁有奧運血統的賽艇場",
    intro: [
      "戶田賽艇場位於埼玉縣戶田公園內，使用的正是1964年東京奧運划船賽事的同一條靜水賽道——是日本唯一擁有奧運歷史的競艇場。這裡同時也是全國24座賽艇場中最狹窄的賽道，賽艇之間距離相當接近，現場觀賽格外刺激。",
      "狹窄且硬實的淡水水面，讓領先艇難以乾淨守住內側航線，因此「捲」（外側超車）戰術在這裡的成功率是全國數一數二的高——戶田的1號艇奪冠率也是全國最低之一。",
    ],
    access: [
      "JR埼京線「戶田公園」站（西口）→ 步行約3公里、40分鐘——強烈建議搭乘賽事日免費接駁巴士",
      "國際興業巴士至「氷川町3丁目」站 → 步行約15分鐘",
    ],
    mapQuery: "ボートレース戸田",
    lat: 35.801908,
    lng: 139.676807,
    videoUrl: "https://www.youtube.com/channel/UCoLCf3aVRMSukwetHfn1p1A",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請「WINWIN Card」，同時也支援免馬券單的下注App，每200日圓投注可獲得1點，點數可兌換電子錢包回饋金。",
      url: "https://www.boatrace-toda.jp/service/cashless.html",
    },
    image: {
      src: "/images/venues/toda.jpg",
      alt: "戶田划船場，戶田賽艇場所在地",
      credit: "Photo by Ibamoto, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Toda_Rowing_Course_(Tokyo,_JAP)_2021.jpg",
    },
    facts: {
      water: "淡水，賽道狹窄——水面硬實",
      character: "全國1號艇奪冠率最低之一——超車戰術頻繁成功",
      nightRace: false,
    },
    tip: "由於超車在這裡格外常見，我們的AI在戶田預測中比其他多數賽場更加重視起跑時間與過彎數據。",
    nearbyAttractions: [
      {
        name: "戶田公園",
        description:
          "1964年東京奧運划船賽事的原始賽道，就位於賽艇場所在地，現已成為市民公園，春季荒川河岸兩側櫻花盛開。",
      },
      {
        name: "上戶田氷川神社",
        description:
          "距賽場約1.5公里的當地神社，若沿著戶田公園站附近的河岸步道散步或騎車，是值得順道一訪的寧靜景點。",
        lat: 35.813919,
        lng: 139.675218,
      },
      {
        name: "戶田橋與荒川河岸",
        description:
          "橫跨荒川、連接埼玉與東京的歷史道路橋，附近的河濱綠地在夏季會舉辦煙火大會。從賽場步行約15分鐘可達。",
        lat: 35.798526,
        lng: 139.660923,
      },
      {
        name: "彩湖與道滿綠地公園",
        description:
          "由荒川蓄水池改建而成的大型公園，是騎自行車、釣魚與風帆運動的熱門去處，園內還有受保護的野生櫻草棲地。距賽場約3公里。",
        lat: 35.825039,
        lng: 139.63012303,
      },
      {
        name: "BOAT KIDS PARK（場內設施）",
        description:
          "賽場內設有的親子遊戲區，佈置了適合拍照的賽艇造景，帶小孩同行時很適合在賽事空檔順道一逛。",
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "tsu",
    code: 9,
    name: "津",
    kanji: "Tsu",
    region: "三重",
    tagline: "面向伊勢灣的風浪水域——東海地區最刁鑽的賽道之一",
    intro: [
      "津賽艇場面朝三重縣伊勢灣，這條南北狹長的海灣會將天氣直接送進賽道——夏季吹南風，冬季則有從鈴鹿山脈吹來、當地人稱為「鈴鹿颪」的強勁寒風。風勢增強時，津會成為東海地區數一數二刁鑽、難以預測的賽道；風平浪靜的日子則相對容易判讀，1號艇較為有利。",
      "賽場本身是明亮寬敞、如購物中心般的空間，設有美食攤位、兒童遊戲區，還有廣受歡迎的吉祥物「Tsukky」，即使不在賽事時間也很適合順道一逛。",
    ],
    access: [
      "JR／近鐵「津」站與近鐵「津新町」站皆提供免費接駁巴士",
      "自駕：距伊勢自動車道津或久居交流道約20分鐘車程",
    ],
    mapQuery: "ボートレース津",
    lat: 34.681031,
    lng: 136.518254,
    videoUrl:
      "https://www.youtube.com/@%E3%83%AC%E3%83%BC%E3%82%B9LIVE%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E6%B4%A5%E3%81%85%E5%85%AC%E5%BC%8F",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請「Tsukki Card」，事先加值後即可使用，中獎獎金會自動存入卡片，不必排隊領獎即可直接前往下一場比賽。",
      url: "https://www.boatrace-tsu.com/",
    },
    image: {
      src: "/images/venues/tsu.jpg",
      alt: "津賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Tsu-kyotei-01.jpg",
    },
    facts: {
      water: "面朝伊勢灣——風大時是東海地區最刁鑽的賽道之一",
      character: "風向決定一切：風大時混亂難測，風平浪靜時1號艇較有利",
      nightRace: false,
    },
    tip: "風勢是津賽艇場最大的變數——我們的AI在每場津的預測中都會納入賽場波動指數分析。",
    nearbyAttractions: [
      {
        name: "津なぎさまち",
        description:
          "可眺望海灣景色的渡輪航廈，內有多間餐廳，高速船約45分鐘可抵達中部國際機場。",
      },
      {
        name: "结城神社",
        description:
          "以約300株垂枝梅聞名的神社，人稱「结城的垂枝梅」，2月中旬至3月中旬盛開，是三重縣數一數二的賞梅名所。",
        lat: 34.697693,
        lng: 136.515215,
      },
      {
        name: "津城跡（お城公園）",
        description:
          "由知名築城名家藤堂高虎重建的城跡，如今是保留部分本丸、護城河與櫓的公園，是市中心一處安靜的歷史景點。",
        lat: 34.717973,
        lng: 136.507393,
      },
      {
        name: "三重縣立博物館（MieMu）",
        description:
          "三重縣的代表性博物館，涵蓋自然史、文化與產業展示，設有適合親子同遊的互動體驗展區。",
        lat: 34.742185,
        lng: 136.501689,
      },
      {
        name: "津觀音寺與大門商店街",
        description:
          "日本三大觀音寺之一，坐落於熱鬧的大門購物美食商店街中心——津是當地名物「天婦羅飯糰」的發源地，值得就近品嚐。",
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "mikuni",
    code: 10,
    name: "三國",
    kanji: "Mikuni",
    region: "福井",
    tagline: "日本唯一面向日本海的賽艇場，緊鄰歷史悠久的港町",
    intro: [
      "三國賽艇場位於福井縣，是全國唯一面向日本海的競艇場。賽道為不受潮汐影響的淡水人工水池，但隨著白天氣溫升高常會吹起海風，為賽況增添變數。由於水面不受潮汐影響，馬力強勁的賽艇往往能穩定發揮優勢。",
      "賽場緊鄰三國湊——一座保存完好的北前船貿易古港町，鄰近日本數一數二壯觀的海岸線。",
    ],
    access: [
      "JR「蘆原溫泉」站 → 免費接駁巴士",
      "越前鐵道「蘆原湯之町」站 → 步行約17分鐘",
    ],
    mapQuery: "ボートレース三国",
    lat: 36.23277732,
    lng: 136.18537486,
    videoUrl: "https://www.youtube.com/channel/UCu-yP6WJQ0zcx5nmWhxvJEg",
    cashless: {
      note: "截至2026年，賽場尚未導入電子支付投注系統，所有購票僅收現金。設有免費的「三國Boat Point Card」集點卡，但僅能累積點數，無法儲值投注金額。",
      url: "https://www.boatrace-mikuni.jp/sp/index.php?page=service-pointcard",
    },
    image: {
      src: "/images/venues/mikuni.jpg",
      alt: "三國賽艇場",
      credit: "Photo by SONIC BLOOMING, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Boat_Race_Mikuni.jpg",
    },
    facts: {
      water: "淡水人工水池，不受潮汐影響——白天氣溫上升後常有海風",
      character: "馬力強勁的賽艇有穩定優勢",
      nightRace: false,
    },
    tip: "由於不受潮汐干擾，馬達性能數據在這裡格外可靠——這正是我們AI在三國預測中最重視的分析項目。",
    nearbyAttractions: [
      {
        name: "東尋坊",
        description:
          "沿海岸綿延約1公里的壯觀玄武岩海崖，以獨特的六角形岩柱聞名，被列為日本數一數二的絕景之一。",
        lat: 36.23778,
        lng: 136.12528,
      },
      {
        name: "三國湊",
        description:
          "保存完好的北前船貿易古港町，老街上林立著商家建築，還能品嚐當季新鮮海鮮（含螃蟹），距三國站約5分鐘路程。",
      },
      {
        name: "三國神社",
        description:
          "北陸三大祭典之一「三國祭」的舉辦地，每年5月會出動六座巨大的山車遊行——神社本身暱稱「Osan之神」，全年都值得一訪。",
        lat: 36.20599,
        lng: 136.16072,
      },
      {
        name: "蘆原溫泉",
        description:
          "福井縣最知名的溫泉鄉之一，聚集數十間旅館與公共浴場，從賽場搭乘免費接駁巴士約10分鐘可達蘆原溫泉站方向。",
        lat: 36.21456164,
        lng: 136.23503542,
      },
      {
        name: "丸岡城",
        description:
          "日本現存最古老的天守之一，建於16世紀，城丘上種滿櫻花，春季吸引大量賞花人潮，從賽場開車約25分鐘可達。",
        lat: 36.152363,
        lng: 136.272073,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "biwako",
    code: 11,
    name: "琵琶湖",
    kanji: "Biwako",
    region: "滋賀",
    tagline: "日本景色最優美的賽艇場，坐落於琵琶湖畔",
    intro: [
      "琵琶湖賽艇場位於日本最大淡水湖——琵琶湖畔，隔著湖面可眺望三上山（人稱「近江富士」）與伊吹山，是全國景色最優美的競艇場之一。觀光遊覽船「密西根號」也經常在比賽期間於湖面上悠然行駛。",
      "春夏季常吹起離岸風，可能讓水面變得較不平穩，因此這裡的比賽條件比完全受屏障保護的賽場變化更大——是欣賞美景之餘也值得留意的一點。",
    ],
    access: [
      "京阪「別所」站 → 步行約9分鐘",
      "自駕：距名神高速公路大津或京都東交流道約15分鐘車程",
    ],
    mapQuery: "ボートレースびわこ",
    lat: 35.01730116,
    lng: 135.86110332,
    videoUrl: "https://www.youtube.com/channel/UCLbcsJqsT5Qa1axpYcOBpmg",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請「Bina Touch」卡；另有共通集點方案「近江Point Club」，在此累積的點數也能在三國、住之江與尼崎共同使用。",
      url: "https://www.boatrace-biwako.jp/modules/service/?page=index_point",
    },
    image: {
      src: "/images/venues/biwako.jpg",
      alt: "琵琶湖賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Biwako-kyotei-01.jpg",
    },
    facts: {
      water: "淡水（琵琶湖）——春夏季離岸風可能使水面變得較不平穩",
      character: "日本景色最優美的賽艇場之一；水面條件隨風勢變化",
      nightRace: false,
    },
    tip: "湖面風勢可能讓賽事中途的水面條件產生變化——我們的AI在每場琵琶湖預測中都會納入賽場波動指數分析。",
    nearbyAttractions: [
      {
        name: "琵琶湖畔景觀",
        description:
          "就在賽場旁，可眺望三上山與伊吹山隔湖相望的壯闊景色，觀光遊覽船「密西根號」等船隻也經常在湖面上巡航。",
      },
      {
        name: "三井寺（園城寺）",
        description:
          "日本四大名寺之一，寺內梵鐘被譽為日本音色最優美的鐘聲之一，並列入UNESCO世界遺產暫定名單，距賽場約1公里。",
        lat: 35.01335,
        lng: 135.852822,
      },
      {
        name: "琵琶湖疏水",
        description:
          "19世紀興建、連接琵琶湖與京都的運河，沿岸設有賞櫻步道，是三井寺附近一段風景優美的散步路線。",
        lat: 35.012481,
        lng: 135.858029,
      },
      {
        name: "近江神宮",
        description:
          "供奉天智天皇的神社，坐落於林木蓊鬱的山坡上，以舉辦日本全國歌牌（かるた）錦標賽聞名，從賽場開車約20分鐘可達。",
        lat: 35.032216,
        lng: 135.852109,
      },
      {
        name: "渚公園與大津湖畔",
        description:
          "沿湖而建的狹長公園，種有應季花卉（春季有芝櫻），鄰近琵琶湖大津王子飯店，從賽場往南步行約15分鐘即可享受悠閒的湖畔散步。",
        lat: 35.004965,
        lng: 135.889099,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "amagasaki",
    code: 13,
    name: "尼崎",
    kanji: "Amagasaki",
    region: "兵庫",
    tagline: "一出車站就到——日本水面最平穩的賽場之一",
    intro: [
      "尼崎賽艇場的交通便利程度在競艇界數一數二：賽場就緊鄰阪神電鐵「尼崎中央運動公園前」站，就算下雨天也幾乎不需要撐傘。這裡的水面以全國最平穩、最考驗技術聞名，淡水賽道，船底下的水面十分紮實。",
      "全年大多數時候賽道會吹逆風，但當低氣壓或降雨接近時，風向也可能轉為順風。近年來1號艇在這裡的奪冠率超過六成，讓尼崎成為日本內側最有利的賽場之一。",
    ],
    access: [
      "阪神電鐵「尼崎中央運動公園前」站 → 緊鄰賽場",
      "從大阪梅田可搭乘直達特急或急行列車，或從神戶三宮於「西宮」站轉乘普通車",
    ],
    mapQuery: "ボートレース尼崎",
    lat: 34.719489,
    lng: 135.393973,
    videoUrl: "https://www.youtube.com/@AMABOATRACE",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請免費的「AMA+」卡，可在場內機台加值，每100日圓投注可獲得1點，點數可兌換指定席票券、QUO卡或場館周邊商品。",
      url: "https://www.boatrace-amagasaki.jp/sp/index.php?page=service-cashless",
    },
    image: {
      src: "/images/venues/amagasaki.jpg",
      alt: "尼崎賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Amagasaki-kyotei-01.jpg",
    },
    facts: {
      water: "淡水，水面紮實平穩——有利於技術型選手發揮",
      character: "日本內側最有利的賽場之一（1號艇奪冠率超過60%）",
      nightRace: false,
    },
    tip: "由於1號艇在這裡奪冠率極高，我們的AI在每場尼崎預測中都會特別重視起跑水道的優勢分析。",
    nearbyAttractions: [
      {
        name: "尼崎城",
        description:
          "在原址重建的江戶時代城郭（2019年重新開放），館內設有介紹城下町歷史的博物館，距賽場約2公里。",
        lat: 34.716723,
        lng: 135.41875,
      },
      {
        name: "寺町（尼崎城下寺院群）",
        description:
          "緊鄰尼崎城的歷史街區，保留11座寺院，維持著昔日城下町的風貌，與賽事的熱鬧氣氛形成寧靜對比。",
      },
      {
        name: "尼崎存錢筒博物館",
        description:
          "由當地信用金庫經營的特色企業博物館，展示來自世界各地的數千個存錢筒，可以和附近的尼崎城與寺町街區一起安排參觀。",
        lat: 34.716214,
        lng: 135.413431,
      },
      {
        name: "汐江須佐男神社",
        description:
          "以夏季祭典聞名的當地神社，若在阪神尼崎站周邊散步，值得順道一訪的寧靜景點。",
        lat: 34.737332,
        lng: 135.435484,
      },
      {
        name: "阪神尼崎站周邊",
        description:
          "市內主要交通樞紐，周邊有商店街與近期整修完成的中央公園，適合作為結合市區其他觀光行程的據點。",
      },
    ],
    schedule: {
      typicalRaceDays:
        "尼崎一年約舉辦180天賽事，比大多數賽場更頻繁。每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "naruto",
    code: 14,
    name: "鳴門",
    kanji: "Naruto",
    region: "德島",
    tagline: "水面寬闊、爆冷頻傳，緊鄰著名漩渦景觀",
    intro: [
      "鳴門賽艇場位於德島縣小鳴門海峽畔，看台距離賽道近到讓現場觀賽格外緊張刺激。雖然是海水賽道，但有防波堤保護，水面依然平穩。這裡的1號艇實力偏弱——任何水道都有機會奪冠，爆冷屢見不鮮，配當也常常偏高，是喜歡追高倍率的投注者鍾愛的賽場。",
      "賽場最多一年營運360天，售票時間從清晨一路持續到晚上約8點半，包含夜間賽事，幾乎隨時都有比賽可看。",
    ],
    access: [
      "JR「鳴門」站 → 步行約10分鐘",
      "從JR鳴門站或德島機場搭乘巴士 → 於「高速鳴門」站下車",
    ],
    mapQuery: "ボートレース鳴門",
    lat: 34.190725,
    lng: 134.609646,
    videoUrl: "https://www.youtube.com/channel/UCd8rJfg7p8qsASOEIIwAinQ",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請「鳴子e-CLUB」卡；每200日圓投注可獲得1點，使用該卡支付指定席費用可享9折優惠，中獎獎金也會保留在卡片內跨日使用。",
      url: "https://www.n14.jp/sp/index.php?page=service-cashless",
    },
    image: {
      src: "/images/venues/naruto.jpg",
      alt: "鳴門賽艇場",
      credit: "Photo by Na00ru0010, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Naruto-kyotei-01.jpg",
    },
    facts: {
      water: "海水，有防波堤保護——雖臨海但水面平穩",
      character: "1號艇實力偏弱——任何水道皆有機會奪冠，爆冷與高配當常見",
      nightRace: true,
    },
    tip: "由於這裡1號艇實力偏弱，我們的AI在鳴門預測中會比其他多數賽場更均衡地評估各水道的奪冠機會。",
    nearbyAttractions: [
      {
        name: "鳴門漩渦",
        description:
          "全球數一數二壯觀的潮汐漩渦景觀，可搭乘「渦潮汽船」的觀光船近距離欣賞，或從大鳴門橋的行人步道「渦之道」俯瞰。",
      },
      {
        name: "鳴門公園與千疊敷展望台",
        description:
          "位於懸崖上的公園，可俯瞰漩渦與大鳴門橋，設有展望台，周邊聚集多間餐廳與紀念品店。",
      },
      {
        name: "大塚國際美術館",
        description:
          "展示世界名畫等比例陶板複製品的美術館，收藏從米開朗基羅的西斯汀禮拜堂到莫內的睡蓮系列，是日本樓地板面積數一數二的大型美術館。",
        lat: 34.23203,
        lng: 134.637815,
      },
      {
        name: "鳴門德國館",
        description:
          "建於第一次世界大戰德軍戰俘營舊址的博物館，這裡曾上演日本首次貝多芬第九號交響曲全曲演出，是一段特殊的地方歷史。",
        lat: 34.164678,
        lng: 134.499038,
      },
      {
        name: "道之驛くるくる鳴門",
        description:
          "2022年開幕的現代化公路休息站，販售在地農產、海鮮與餐飲，前往賽場途中順道補給美食的好去處。",
        lat: 34.158134,
        lng: 134.580155,
      },
    ],
    schedule: {
      typicalRaceDays:
        "日本最活躍的賽場之一，最多一年舉辦360天賽事，涵蓋日間與夜間場次。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "marugame",
    code: 15,
    name: "丸龜",
    kanji: "Marugame",
    region: "香川",
    tagline: "受潮汐牽動的瀨戶內海賽道，位於日本烏龍麵之都",
    intro: [
      "丸龜賽艇場面向香川縣的瀨戶內海，賽道水質柔軟浮力佳，是全國潮差最大的競艇場之一——高低潮位差可達約2公尺。這裡常吹逆風，「差」與「捲差」等超車戰術在此的成功率高於單純的逃走戰術。",
      "自2009年推出夜間賽事「Blue Nighter」計畫以來，丸龜便持續在燈光下比賽，如今已是全年舉辦夜間賽事的賽場。",
    ],
    access: [
      "JR予讚線「丸龜」站 → 免費接駁巴士，約10分鐘",
      "自駕：距高松自動車道或瀨戶中央自動車道坂出、善通寺交流道約15-20分鐘車程",
    ],
    mapQuery: "ボートレース丸亀",
    lat: 34.30469395,
    lng: 133.79470945,
    videoUrl: "https://www.youtube.com/channel/UC2CWDMG18mpBGXkI9KHdACQ",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請「B Card」，每100日圓投注可獲得1點，使用該卡支付指定席費用通常可享半價優惠。",
      url: "https://www.marugameboat.jp/sp/pointcard.htm",
    },
    image: {
      src: "/images/venues/marugame.jpg",
      alt: "丸龜賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Marugame-kyotei-02.jpg",
    },
    facts: {
      water: "海水，瀨戶內海——潮差顯著（最高約2公尺）",
      character: "超車戰術（差、捲差）成功率高於單純逃走",
      nightRace: true,
    },
    tip: "這裡的潮汐會實實在在地改變整場賽事的水面條件——我們的AI在每場丸龜預測中都會納入潮汐時間的分析。",
    nearbyAttractions: [
      {
        name: "丸龜城",
        description:
          "建城400年、日本現存12座木造原始天守之一，以壯觀的弧形石垣聞名，擁有全日本最高的現存石造城牆。",
        lat: 34.286115,
        lng: 133.800334,
      },
      {
        name: "丸龜烏龍麵",
        description:
          "丸龜是日本數一數二的烏龍麵之都，從賽場步行不遠就能找到多間知名麵店。",
      },
      {
        name: "丸龜市豬熊弦一郎現代美術館（MIMOCA）",
        description:
          "面向JR丸龜站、外觀搶眼的現代建築，展示香川縣出身藝術家豬熊弦一郎的作品，同時也舉辦當代藝術特展。",
        lat: 34.291214,
        lng: 133.792025,
      },
      {
        name: "中津萬象園與團扇博物館",
        description:
          "傳統江戶時代回遊式庭園，園內設有茶室，現已將遷移過來的丸龜團扇博物館一併納入——丸龜製作了全日本約九成的傳統紙製團扇。",
        lat: 34.285108,
        lng: 133.769663,
      },
      {
        name: "丸龜港",
        description:
          "市內歷史悠久的港口，江戶時代曾是重要貿易港，如今仍有渡輪往返鄰近的小豆島與本島。",
      },
    ],
    schedule: {
      typicalRaceDays:
        "自2009年起為全年舉辦夜間賽事的賽場。每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "kojima",
    code: 16,
    name: "兒島",
    kanji: "Kojima",
    region: "岡山",
    tagline: "瀨戶大橋橋影下的平穩水面",
    intro: [
      "兒島賽艇場位於岡山縣倉敷市的瀨戶內海畔，緊鄰瀨戶大橋，從看台就能眺望大橋與海上星羅棋布的島嶼。這裡潮差顯著，但風勢通常不大，因此比賽多半平穩、容易判讀，較少出現混亂局面。",
      "兒島同時也是日本的牛仔褲之都：從賽場出發不遠就能抵達兒島牛仔褲街，數十間店鋪販售在地製作的牛仔褲——很適合安排在賽事日一併走訪。",
    ],
    access: [
      "JR瀨戶大橋線「兒島」站 → 免費接駁巴士，約3-5分鐘",
      "自駕：距瀨戶中央自動車道兒島交流道約5分鐘車程",
    ],
    mapQuery: "ボートレース児島",
    lat: 34.44852433,
    lng: 133.80919362,
    videoUrl: "https://www.youtube.com/channel/UC6IrOXVuw6xXLl1qJqYUrsg",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請免費的「K Smart Card」，每100日圓投注可獲得1點（指定席消費點數更多），點數可兌換電子錢包或場館商品，也能在場外設施使用。",
      url: "https://www.kojimaboat.jp/cashless.html",
    },
    image: {
      src: "/images/venues/kojima.jpg",
      alt: "兒島賽艇場",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Kojima-kyotei-01.jpg",
    },
    facts: {
      water: "海水，瀨戶內海——潮差顯著，風勢通常較弱",
      character: "受潮汐牽動但整體平穩、容易判讀",
      nightRace: false,
    },
    tip: "由於風勢在這裡很少造成影響，潮汐時機主導了大部分賽況——我們的AI在每場兒島預測中都會密切追蹤潮汐數據。",
    nearbyAttractions: [
      {
        name: "兒島牛仔褲街",
        description:
          "位於味野地區、長約400公尺的購物街，兩側林立販售在地製作牛仔褲的店鋪——兒島被視為日本的牛仔褲製造之都，這裡是店鋪最集中的一段。",
      },
      {
        name: "舊野崎家住宅",
        description:
          "由製鹽業巨賈興建的江戶時代大型商家宅邸，約1,000坪的建築群保存至今並作為博物館開放，與附近現代化的牛仔褲店鋪形成鮮明對比。",
      },
      {
        name: "下津井港與城跡",
        description:
          "歷史悠久的漁港，後方山丘上有下津井城遺跡，如今已成為瀨戶大橋紀念公園的一部分，春季可賞櫻。",
        lat: 34.43678,
        lng: 133.797712,
      },
      {
        name: "鷲羽山展望台",
        description:
          "山頂展望台，可眺望瀨戶內海與瀨戶大橋的壯闊景色，夕陽時分格外動人。",
        lat: 34.434429,
        lng: 133.813915,
      },
      {
        name: "瀨戶大橋觀光遊覽船",
        description:
          "從兒島觀光港出發，約45分鐘的遊覽行程，可近距離仰望瀨戶大橋橋下風光。",
        lat: 34.43678,
        lng: 133.797712,
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "miyajima",
    code: 17,
    name: "宮島",
    kanji: "Miyajima",
    region: "廣島",
    tagline: "日本水面條件數一數二刁鑽的賽場，正對宮島",
    intro: [
      "宮島賽艇場緊鄰前往宮島的渡輪碼頭，天氣晴朗時，從看台就能望見往來渡輪與UNESCO世界遺產嚴島神社的鳥居——是競艇界數一數二壯觀的景色。這裡的瀨戶內海水面被視為全日本最考驗技術的賽道之一。",
      "超過4公尺的潮差讓賽道整天呈現不同面貌：低潮時防波堤能阻擋風勢、比較好比賽，高潮時水面則變得起伏不定、賽況更加緊湊。風向常在上午與下午之間轉變，容易影響起跑表現。",
    ],
    access: [
      "JR「宮島口」站 → 步行約3分鐘",
      "賽事日廣電宮島線路面電車會直接停靠賽場",
    ],
    mapQuery: "ボートレース宮島",
    lat: 34.315217,
    lng: 132.306522,
    videoUrl:
      "https://www.youtube.com/@%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E5%AE%AE%E5%B3%B6%E3%83%81%E3%83%A3%E3%83%B3%E3%83%8D%E3%83%AB%E5%85%AC%E5%BC%8F",
    cashless: {
      note: "現場僅收現金，不支援信用卡。若想使用電子支付投注，可申請「MOMIJI CARD」，當天申請當天即可使用，每200日圓投注可獲得1點，持卡者還能免費進入3樓「MOMIJI」桌席區。",
      url: "https://www.boatrace-miyajima.com/momiji_card.html",
    },
    image: {
      src: "/images/venues/miyajima.jpg",
      alt: "宮島賽艇場",
      credit: "Photo by Ujinaport, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Miyajima_Kyotei_01.jpg",
    },
    facts: {
      water: "海水，瀨戶內海——潮差超過4公尺，日本數一數二考驗技術的賽道",
      character: "低潮時平穩、高潮時起伏緊湊；起跑表現容易不穩定",
      nightRace: false,
    },
    tip: "潮汐狀態在這裡的重要性幾乎居全國之冠——我們的AI在每場宮島預測中都會重點納入潮汐分析。",
    nearbyAttractions: [
      {
        name: "宮島口渡輪碼頭",
        description:
          "就在賽場旁的本州側渡輪碼頭，班次頻繁，約10分鐘即可抵達宮島——是結合賽事與宮島觀光最方便的方式。",
        lat: 34.3112306,
        lng: 132.3052806,
      },
      {
        name: "嚴島神社",
        description:
          "以海上鳥居聞名的UNESCO世界遺產神社，坐落於宮島島上，從賽場搭渡輪即可短程抵達。",
        lat: 34.295922,
        lng: 132.319816,
      },
      {
        name: "五重塔與千疊閣",
        description:
          "建於1407年、色彩鮮豔的五重塔，緊鄰豐臣秀吉下令興建卻未完工的巨大木造殿堂「千疊閣」，兩者皆座落於嚴島神社旁的小山丘上，可俯瞰神社全景。",
        lat: 34.29272654861169,
        lng: 132.32234728742426,
      },
      {
        name: "宮島水族館",
        description:
          "由市政府經營的水族館，主題聚焦瀨戶內海的海洋生物，可看到江豚、海獅與企鵝——很適合帶小朋友一同前往。",
      },
      {
        name: "紅葉谷公園",
        description:
          "彌山山腳下的楓葉谷公園，是日本數一數二知名的賞楓勝地，附近設有纜車站，供健行或登山遊客搭乘。",
      },
    ],
    schedule: {
      typicalRaceDays: "每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
  {
    slug: "tokuyama",
    code: 18,
    name: "德山",
    kanji: "Tokuyama",
    region: "山口",
    tagline: "受潮汐牽動的笠戶灣賽道，群山環繞",
    intro: [
      "德山賽艇場面朝山口縣笠戶灣，看台後方是高鹿山，前方則是瀨戶內海的開闊景色。這裡也是全年舉辦晨間賽事的賽場——首場比賽約在早上8點32分開跑，整場賽事在下午初便結束。",
      "斜向順風相當常見，潮差超過3公尺，讓一天之內的比賽風格分成兩種：低潮時是拼馬力的力量賽，強勁馬達的賽艇較有優勢；高潮時水面較難判讀，操控技巧與細膩度更為關鍵。",
    ],
    access: [
      "JR「櫛濱」站為最近的車站",
      "從JR德山站「港口」出口搭乘免費計程車，約20分鐘，服務時間自早上7:45起",
    ],
    mapQuery: "ボートレース徳山",
    lat: 34.010378,
    lng: 131.83555,
    videoUrl:
      "https://www.youtube.com/@%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E5%BE%B3%E5%B1%B1",
    cashless: {
      note: "現場一般購票僅收現金，不支援信用卡。這裡沒有像其他賽場那樣的專屬品牌卡，但提供免費的通用型預付卡；每投注200日圓可獲得1點，可兌換現金或德山限定周邊商品。",
      url: "https://www.boatrace-tokuyama.jp/uploads/info_event/cashless.pdf",
    },
    image: {
      src: "/images/venues/tokuyama.jpg",
      alt: "德山賽艇場",
      credit: "Photo by dora1977, public domain, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Tokuyamakyotei.JPG",
    },
    facts: {
      water: "海水，笠戶灣——潮差超過3公尺",
      character: "低潮時是力量賽，高潮時考驗操控技巧",
      nightRace: false,
    },
    tip: "由於低潮與高潮時的比賽風格差異明顯，我們的AI在每場德山預測中都會同時分析潮汐時機與馬達、操控數據。",
    nearbyAttractions: [
      {
        name: "德山動物園",
        description:
          "廣受家庭歡迎的市立動物園，貓熊是館內較受矚目的明星動物之一，從賽場開車約20分鐘可達。",
        lat: 34.062152,
        lng: 131.816085,
      },
      {
        name: "周南市美術博物館",
        description:
          "介紹當地藝術與歷史的地區博物館，就在德山動物園附近，可以安排在同一趟行程中順道參觀。",
        lat: 34.060194,
        lng: 131.812083,
      },
      {
        name: "德山站與銀南街商店街",
        description:
          "市內主要車站及緊鄰的有頂蓋商店街，餐廳與店鋪林立，適合在賽場行程前後順道一逛。",
        lat: 34.051194,
        lng: 131.80225,
      },
      {
        name: "晴海親水公園",
        description:
          "面向德山灣的濱海公園，設有步道與草坪，是悠閒散步的好去處。",
        lat: 34.047413,
        lng: 131.795738,
      },
      {
        name: "瀨戶內海景致",
        description:
          "賽場本身就能眺望笠戶灣與背後的高鹿山，即使不在賽事時間，這片景色也值得駐足欣賞。",
      },
    ],
    schedule: {
      typicalRaceDays:
        "全年舉辦晨間賽事的賽場。每年固定舉辦多次例行賽，每次約4至7天。",
      seasonalNotes: "偶爾會舉辦SG／G1等全國性大賽，確切日期請查詢官方賽程。",
    },
  },
];
