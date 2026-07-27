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
    nearbyAttractions: [
      {
        name: "Heiwajima Onsen (natural hot spring)",
        description:
          "In the same BIG FUN Heiwajima complex — natural hot spring baths and a rock-bed sauna, open late.",
      },
      {
        name: "Tondemi Heiwajima (indoor athletic park)",
        description:
          "Trampolines, a climbing wall and rope courses in the same complex — good for families.",
      },
      {
        name: "Haneda Airport",
        description:
          "About 20-30 minutes by Keikyu Line — an easy stop before or after a flight.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
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
    nearbyAttractions: [
      {
        name: "Namba & Shinsaibashi",
        description:
          "Osaka's main shopping and dining district, about 15 minutes away by metro.",
      },
      {
        name: "Sumiyoshi Taisha",
        description:
          "One of Japan's oldest and most important Shinto shrines, about 20 minutes away.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days, plus periodic multi-day SG/G1 tournaments.",
      seasonalNotes:
        "Hosts the SG Grand Prix, the sport's season-ending championship, most years in December — one of the biggest events in Kyotei.",
    },
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
    nearbyAttractions: [
      {
        name: "Kasai Rinkai Park",
        description:
          "Seaside park with a large aquarium, a giant Ferris wheel and BBQ areas, one JR Keiyo Line stop from the Tokyo Disney Resort area.",
      },
      {
        name: "Kitaro Walkway (on-site)",
        description:
          "The venue's own embankment stands are lined with yokai artwork by Shigeru Mizuki, creator of GeGeGe no Kitaro.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
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
    nearbyAttractions: [
      {
        name: "Tokyo Racecourse (horse racing)",
        description:
          "JRA's major Fuchu racecourse is about a 14-minute walk away — a rare chance to see two very different kinds of Japanese racing in one trip.",
      },
      {
        name: "Fuchu city center",
        description:
          "Restaurants and shops around Fuchu-Honmachi and Bubaigawara stations, connected by free race-day shuttle buses.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
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
    nearbyAttractions: [
      {
        name: "Ohori Park",
        description:
          "A large scenic park with a Japanese garden, a boating pond and lakeside cafes, 4 minutes from Tenjin by subway.",
      },
      {
        name: "Tenjin",
        description:
          "Fukuoka's main shopping, dining and nightlife district, about 15 minutes on foot.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/fukuoka.jpg",
      alt: "Main entrance of Boat Race Fukuoka",
      credit: "Photo by STA3816, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Main_entrance_of_Boat_Race_Fukuoka.jpg",
    },
  },
  {
    slug: "kiryu",
    code: 1,
    name: "Kiryu",
    kanji: "桐生",
    region: "Gunma",
    regionGroup: "kanto",
    tagline: "The birthplace of night racing — Japan's highest-altitude venue",
    intro: [
      "Boat Race Kiryu, in Gunma prefecture, was the first of Japan's 24 venues to introduce night racing, back in 1997, and today every card here runs entirely under floodlights (first race around 3pm, last race around 8:30pm). It's also the highest-altitude Kyotei venue in the country, sitting 128 meters above sea level.",
      'The thinner air at altitude means motors produce slightly less power than at sea-level venues, which tends to favor dash-style (outside lane) racers over pure escapes. A strong seasonal tailwind known as the "Akagi-oroshi" blows through in winter and spring, adding another layer to the racing.',
    ],
    access: [
      'JR Ryomo Line "Iwajuku" station → about 12 minutes on foot, or free shuttle bus',
      'Free shuttle buses also run from "Azami" station on race days',
    ],
    facts: {
      water: "Freshwater pond",
      character: "Highest altitude in Japan — thinner air favors dash racers",
      nightRace: true,
    },
    tip: "Lower air pressure here quietly shifts the balance toward outside-lane dash racers — our AI weighs altitude effects into every Kiryu prediction.",
    nearbyAttractions: [
      {
        name: "Kiryu Shinmachi Weaving District",
        description:
          "A preserved historic textile district with saw-tooth roof factories — Kiryu has been a major silk weaving town for 400 years.",
      },
      {
        name: "Orimono Sankokan Textile Museum",
        description:
          "A museum dedicated to Kiryu's textile heritage, with working looms on display.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Every card here runs at night. Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/kiryu.jpg",
      alt: "Boat Race Kiryu stadium",
      credit: "Photo by cake6, CC BY 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Kiryu-kyotei-01.jpg",
    },
  },
  {
    slug: "toda",
    code: 2,
    name: "Toda",
    kanji: "戸田",
    region: "Saitama",
    regionGroup: "kanto",
    tagline:
      "Japan's narrowest course — the only venue with an Olympic pedigree",
    intro: [
      "Boat Race Toda sits inside Toda Park in Saitama, on the same still-water course used for the 1964 Tokyo Olympics rowing events — the only Kyotei venue with an Olympic history. The course is also the narrowest of Japan's 24 venues, putting boats close together and making for some of the most exciting racing to watch live.",
      'The narrow, hard-packed freshwater surface makes it difficult for the front-runner to hold the inside line cleanly, so "makuri" (outside overtaking) passes succeed here more often than almost anywhere else in Japan — Toda has one of the lowest lane-1 win rates in the sport.',
    ],
    access: [
      'JR Saikyo Line "Toda-Koen" station (west exit) → about 3km / 40 minutes on foot — the free race-day shuttle bus is strongly recommended',
      'Kokusai Kogyo bus to "Hikawacho 3-chome" stop → about 15 minutes on foot',
    ],
    facts: {
      water: "Freshwater, narrow course — hard surface",
      character:
        "One of the lowest lane-1 win rates in Japan — overtakes are common",
      nightRace: false,
    },
    tip: "With overtakes this common, our AI leans harder on start-timing and turn data for Toda than for almost any other venue.",
    nearbyAttractions: [
      {
        name: "Toda Park",
        description:
          "The 1964 Olympic rowing course itself, now a public park with cherry blossoms along the Arakawa riverbank in spring.",
      },
      {
        name: "BOAT KIDS PARK Morvi Toda (on-site)",
        description:
          "A family-friendly play area inside the venue with photo-ready boat displays.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/toda.jpg",
      alt: "Toda Rowing Course, home of Boat Race Toda",
      credit: "Photo by Ibamoto, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Toda_Rowing_Course_(Tokyo,_JAP)_2021.jpg",
    },
  },
  {
    slug: "hamanako",
    code: 6,
    name: "Hamanako",
    kanji: "浜名湖",
    region: "Shizuoka",
    regionGroup: "chubu-tokai",
    tagline: "Japan's widest race course, on a brackish lake famous for eel",
    intro: [
      'Boat Race Hamanako sits on the western shore of Lake Hamana in Shizuoka, on the widest competition water of any of Japan\'s 24 venues. The lake is brackish — a mix of seawater and freshwater — and the sheer size of the course lets boats hit high speed, so outside-lane overtakes ("makuri-sashi") succeed more often here than at narrower venues.',
      "From March to September the last race runs into dusk under a summer-time schedule, ending a little after 5pm rather than the usual daytime finish — a nice option if you want racing plus an evening in the area.",
    ],
    access: [
      'JR Tokaido Line "Arai-machi" station → about 5 minutes on foot',
      "By car: about 30 minutes from Hamamatsu-nishi, Mikkabi or Kanzanji Smart ICs",
    ],
    facts: {
      water:
        "Brackish (lake, mix of sea and freshwater) — widest course in Japan",
      character: "High-speed water; outside-lane overtakes are common",
      nightRace: false,
    },
    tip: "The extra-wide course rewards outside dash racers more than most venues — our AI weighs this into every Hamanako prediction.",
    nearbyAttractions: [
      {
        name: "Kanzanji Onsen",
        description:
          "A hot-spring resort town on the lakeshore, known for eel (unagi) cuisine and lake views.",
      },
      {
        name: "Hamanako Parupal & Garden Park",
        description:
          "A lakeside amusement park and flower garden, both popular family day-trip spots near Kanzanji.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days. From March to September, the final race runs slightly later under a summer schedule.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/hamanako.jpg",
      alt: "Boat Race Hamanako stadium",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Hamanako-kyotei-01.jpg",
    },
  },
  {
    slug: "gamagori",
    code: 7,
    name: "Gamagori",
    kanji: "蒲郡",
    region: "Aichi",
    regionGroup: "chubu-tokai",
    tagline:
      "A fast, sheltered course by Mikawa Bay — one of the few night venues",
    intro: [
      "Boat Race Gamagori sits on Mikawa Bay in Aichi prefecture, with a backstretch at the first mark that's the widest in the country. The water is calm and fast, sheltered from strong wind, so races here are quick and lane 1 wins often — but center-lane overtakes still work often enough to produce dramatic comebacks at the second mark.",
      "Gamagori is also one of the relatively small number of venues that races at night, with the water sparkling under floodlights for a distinctive atmosphere you won't get at a daytime card.",
    ],
    access: [
      'JR Tokaido Line "Mikawa-Shiotsu" station → about 5 minutes on foot',
      'Meitetsu Gamagori Line "Gamagori Kyoteijo-mae" station, or a direct bus from JR Gamagori station every 30 minutes',
    ],
    facts: {
      water: "Freshwater pool — calm and fast, sheltered from wind",
      character:
        "Lane 1 wins often, but center-lane comebacks are common at mark 2",
      nightRace: true,
    },
    tip: "Fast, sheltered water raises the value of a clean start here — our AI weighs start-timing data heavily in every Gamagori prediction.",
    nearbyAttractions: [
      {
        name: "Takeshima Island",
        description:
          "Gamagori's symbol — a small sacred island reached by a bridge, home to Yaotomi Shrine.",
      },
      {
        name: "Laguna Ten Bosch",
        description:
          "A seaside resort with a theme park, shopping and dining, about 15 minutes by free shuttle bus from JR Gamagori station.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: null,
  },
  {
    slug: "tokoname",
    code: 8,
    name: "Tokoname",
    kanji: "常滑",
    region: "Aichi",
    regionGroup: "chubu-tokai",
    tagline: "Across the bay from Centrair Airport — a tricky pit start",
    intro: [
      "Boat Race Tokoname sits directly across the water from Chubu Centrair International Airport in Aichi, making it one of the easiest venues in Japan to combine with a flight. The pit area, where boats launch from before the start, is longer here than at most venues, which makes a clean pit-out trickier to time.",
      "Tokoname is also a historic pottery town, so a race-day visit pairs naturally with a stroll through its famous ceramics district.",
    ],
    access: [
      'Meitetsu Tokoname Line "Tokoname" station → about 5 minutes on foot',
      "From Chubu Centrair Airport: about 5 minutes by train to Tokoname station, then 5 minutes on foot",
    ],
    facts: {
      water: "Seawater pool (gated — no tidal effect)",
      character: "Long pit area — pit-out timing is trickier than most venues",
      nightRace: false,
    },
    tip: "Because pit-out here is unusually tricky to time, start-timing data carries extra weight in our Tokoname predictions.",
    nearbyAttractions: [
      {
        name: "Yakimono Sanpo-michi (Pottery Walking Trail)",
        description:
          "A historic ceramics district with brick kiln chimneys and craft studios, about 5 minutes from Tokoname station.",
      },
      {
        name: "Chubu Centrair International Airport",
        description:
          "Just across the bay — an easy combination with a flight before or after racing.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/tokoname.jpg",
      alt: "Boat Race Tokoname stadium",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Tokoname-kyotei-01.jpg",
    },
  },
  {
    slug: "tsu",
    code: 9,
    name: "Tsu",
    kanji: "津",
    region: "Mie",
    regionGroup: "chubu-tokai",
    tagline: "Ise Bay's wind-tossed water — one of Tokai's roughest courses",
    intro: [
      'Boat Race Tsu faces Ise Bay in Mie prefecture, a long north-south inlet that funnels the weather straight at the course — a southerly sea breeze in summer, and a strong cold wind known as the "Suzuka-oroshi" blowing off the Suzuka mountains in winter. When the wind picks up, Tsu becomes one of the roughest, most unpredictable courses in the Tokai region; on calm days it races much more predictably, with lane 1 favored.',
      "The venue itself is a bright, mall-like space with food stalls, a kids' play area and a popular mascot, Tsukky, making it an easy stop even outside race hours.",
    ],
    access: [
      'Free shuttle buses from JR/Kintetsu "Tsu" station and Kintetsu "Tsu-Shinmachi" station',
      "By car: about 20 minutes from Tsu or Hisai interchanges on the Ise Expressway",
    ],
    facts: {
      water:
        "Faces Ise Bay — can be one of the roughest courses in Tokai when windy",
      character:
        "Wind-dependent: rough and unpredictable when windy, lane-1-favored when calm",
      nightRace: false,
    },
    tip: "Wind is the single biggest swing factor at Tsu — our AI factors venue volatility into every prediction here.",
    nearbyAttractions: [
      {
        name: "Tsu Nagisamachi",
        description:
          "A ferry terminal with restaurants overlooking the bay; high-speed boats connect to Chubu Centrair Airport in about 45 minutes.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/tsu.jpg",
      alt: "Boat Race Tsu stadium",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Tsu-kyotei-01.jpg",
    },
  },
  {
    slug: "mikuni",
    code: 10,
    name: "Mikuni",
    kanji: "三国",
    region: "Fukui",
    regionGroup: "chubu-tokai",
    tagline: "Japan's only Sea of Japan venue, next to a historic port town",
    intro: [
      "Boat Race Mikuni, in Fukui prefecture, is the only Kyotei venue on the Sea of Japan coast. The course is a freshwater pool with no tidal effect, but a sea breeze often picks up as the day warms, adding a wrinkle to the racing. Because the water is unaffected by tides, strong-motor boats tend to have a reliable edge here.",
      "The venue sits close to Mikuni-minato, a former Kitamae-bune trading port with a well-preserved old town, and within reach of one of Japan's most dramatic coastlines.",
    ],
    access: [
      'JR "Awara Onsen" station → free shuttle bus',
      'Echizen Railway "Awara-Yunomachi" station → about 17 minutes on foot',
    ],
    facts: {
      water:
        "Freshwater pool, no tidal effect — sea breeze picks up later in the day",
      character: "Strong-motor boats have a reliable edge",
      nightRace: false,
    },
    tip: "With no tide to complicate things, motor performance data is especially reliable here — exactly what our AI weighs most heavily for Mikuni.",
    nearbyAttractions: [
      {
        name: "Tojinbo",
        description:
          "Dramatic basalt sea cliffs stretching about a kilometer along the coast, ranked among Japan's most scenic spots.",
      },
      {
        name: "Mikuni-minato",
        description:
          "A historic Kitamae-bune trading port with a preserved old town and fresh seafood, including crab in season, about 5 minutes from Mikuni station.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: null,
  },
];
