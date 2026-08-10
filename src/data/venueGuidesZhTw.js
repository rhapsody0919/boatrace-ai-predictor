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
];
