/**
 * 英語版 会場ガイドのコンテンツデータ（BOA-133）
 * インバウンド観光クエリ向けの英語コンテンツ。事実（アクセス・施設）は各会場公式サイトで確認済み
 * scripts/generate-sitemap.js（node 直実行）からも import されるため、Vite 専用構文を使わず純粋な JS データに保つこと
 */

export const VENUE_GUIDES_EN = [
  {
    slug: "heiwajima",
    code: 4,
    name: "Heiwajima",
    kanji: "平和島",
    region: "Tokyo",
    regionGroup: "kanto",
    tagline: "The most tourist-friendly venue — minutes from Haneda Airport",
    intro: [
      "Boat Race Heiwajima sits inside the BIG FUN Heiwajima entertainment complex in Ota ward, southern Tokyo — complete with bowling, arcades, restaurants and even a natural hot-spring spa next door. If you are staying in Tokyo or have hours to spare around a Haneda flight, this is the easiest venue to experience Kyotei for the first time.",
      "Heiwajima is also famous among bettors as one of the toughest venues for lane 1 in Japan. The tight first turn means escapes (Nige) fail more often than average, producing frequent upsets and juicy payouts — a perfect place to see why venue characteristics matter so much in Kyotei prediction.",
    ],
    access: [
      'Keikyu Line "Heiwajima" station → free shuttle bus (or about 15-20 min on foot)',
      'JR Keihin-Tohoku Line "Omori" station (east exit) → free race-day shuttle bus',
      "From Haneda Airport: roughly 20-30 minutes via Keikyu Line",
    ],
    facts: {
      water: "Seawater / tidal",
      character: "Hard on lane 1 — upsets and high payouts are common",
      nightRace: false,
    },
    tip: "Check the Lane-1 upset index on our prediction page before betting here — Heiwajima is exactly the kind of venue where it pays off.",
    nearbyAttractions: [],
    schedule: {},
    image: {
      src: "/images/venues/heiwajima.jpg",
      alt: "Boat Race Heiwajima stadium",
      credit: "Photo by cake6, CC BY 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Heiwajima-kyotei-01.jpg",
    },
  },
  {
    slug: "suminoe",
    code: 12,
    name: "Suminoe",
    kanji: "住之江",
    region: "Osaka",
    regionGroup: "kinki",
    tagline:
      'The "sacred ground" of Kyotei — night races in the heart of Osaka',
    intro: [
      "Boat Race Suminoe in Osaka is often called the sacred ground of Kyotei. It hosts many of the sport's biggest championships and runs night races (roughly 2:30pm-9:00pm), so you can spend the day sightseeing in Osaka and still catch a full evening of racing under the floodlights.",
      "The venue is a short walk from a metro station, making it one of the most accessible in Japan. Grandstand food, neon-lit water and top-class racers make Suminoe the venue to visit if you only see one boat race in Kansai.",
    ],
    access: [
      'Osaka Metro Yotsubashi Line "Suminoekoen" station (exit 2) → about 3 minutes on foot',
      "From Namba: about 15 minutes by metro",
    ],
    facts: {
      water: "Freshwater pool",
      character: "Balanced racing; hosts many premier (SG/G1) events",
      nightRace: true,
    },
    tip: "Night races mean you can combine Osaka sightseeing by day with Kyotei by night — check our predictions for the evening card.",
    nearbyAttractions: [],
    schedule: {},
    image: {
      src: "/images/venues/suminoe.jpg",
      alt: "Boat Race Suminoe grandstand",
      credit: "Photo by MASA, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Suminoe_Kyotei2.jpg",
    },
  },
  {
    slug: "edogawa",
    code: 3,
    name: "Edogawa",
    kanji: "江戸川",
    region: "Tokyo",
    regionGroup: "kanto",
    tagline: "Japan's only river course — wild water, wild payouts",
    intro: [
      "Boat Race Edogawa in eastern Tokyo is the only venue in Japan built on a natural river. Wind and tide constantly change the water, making it the most unpredictable racing surface in the sport — races here are notorious for upsets.",
      "For spectators this is Kyotei at its rawest: choppy water, boats fighting the current, and payouts that can be spectacular. If you enjoy chaos, Edogawa is your venue.",
    ],
    access: [
      'Toei Shinjuku Line "Funabori" station → free race-day shuttle bus',
      'JR Sobu Line "Hirai" station → free race-day shuttle bus',
    ],
    facts: {
      water: "River (tidal, affected by wind and current)",
      character: "The roughest water in Japan — expect upsets",
      nightRace: false,
    },
    tip: "Weather matters more here than anywhere else. Our AI factors venue volatility into every Edogawa prediction.",
    nearbyAttractions: [],
    schedule: {},
    image: {
      src: "/images/venues/edogawa.jpg",
      alt: "Boat Race Edogawa stadium",
      credit: "Photo by 博柳, CC BY 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:%E6%B1%9F%E6%88%B8%E5%B7%9D%E7%AB%B6%E8%89%87%E5%A0%B4_-_panoramio.jpg",
    },
  },
  {
    slug: "tamagawa",
    code: 5,
    name: "Tamagawa",
    kanji: "多摩川",
    region: "Tokyo (Fuchu)",
    regionGroup: "kanto",
    tagline: "The calmest water in Japan — racing skill in its purest form",
    intro: [
      'Boat Race Tamagawa in western Tokyo is nicknamed "the calmest water in Japan". A windbreak forest and the grandstand shelter the pool from wind, so races are decided by pure technique rather than conditions.',
      'The venue is literally next to its own train station — Kyoteijo-mae ("in front of the boat race stadium") — a rare case of a sport having a station named after it. Calm water makes results relatively easier to read, which suits first-time bettors.',
    ],
    access: [
      'Seibu Tamagawa Line "Kyoteijo-mae" station → about 3 minutes on foot',
      'Free race-day buses from JR "Fuchu-Honmachi" and Keio Line "Tama-reien" stations',
    ],
    facts: {
      water: "Freshwater pool",
      character: "Very calm — skill-driven races, good for beginners",
      nightRace: false,
    },
    tip: "Stable conditions mean racer and motor stats carry extra weight — exactly the data our AI analyzes for every race.",
    nearbyAttractions: [],
    schedule: {},
    image: {
      src: "/images/venues/tamagawa.jpg",
      alt: "Boat Race Tamagawa stadium",
      credit: "Photo by nakashi, CC BY-SA 2.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Boat_race_tamagawa_%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E5%A4%9A%E6%91%A9%E5%B7%9D_(48113070693).jpg",
    },
  },
  {
    slug: "fukuoka",
    code: 22,
    name: "Fukuoka",
    kanji: "福岡",
    region: "Fukuoka (Kyushu)",
    regionGroup: "kyushu",
    tagline: "A downtown venue steps from Tenjin — with famously tricky water",
    intro: [
      "Boat Race Fukuoka may be the most conveniently located gambling venue in Japan: it sits where the Naka river meets Hakata bay, about a 10-minute walk from the Tenjin district in central Fukuoka. You can go from ramen and shopping to live racing in minutes.",
      "The mix of river outflow and seawater creates an unusual swell near the first turn that troubles even top racers — local knowledge and current form matter a lot here.",
    ],
    access: [
      "About 10 minutes on foot north of Tenjin subway station (exit East 1a)",
      "About 15 minutes on foot from Nishitetsu-Fukuoka (Tenjin) station",
    ],
    facts: {
      water: "Brackish (river mouth) — distinctive swell",
      character: "Tricky first turn; watch exhibition performance closely",
      nightRace: false,
    },
    tip: "Swell at the first mark makes exhibition data unusually important — our prediction table shows exhibition times for every racer.",
    nearbyAttractions: [],
    schedule: {},
    image: {
      src: "/images/venues/fukuoka.jpg",
      alt: "Main entrance of Boat Race Fukuoka",
      credit: "Photo by STA3816, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Main_entrance_of_Boat_Race_Fukuoka.jpg",
    },
  },
];
