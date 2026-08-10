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
    mapQuery: "ボートレース平和島",
    lat: 35.586035,
    lng: 139.740333,
    videoUrl: "https://www.youtube.com/@tokyobaytv9067",
    cashless: {
      note: 'The venue itself is cash-only — no card or prepaid system. The adjacent off-track betting facility "Heiwajima Theater" does offer a prepaid card called "P★CARD" if you want cashless betting.',
      url: "https://www.heiwajima.gr.jp/sp/cashless/cashless.htm",
    },
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
          "Open 24 hours in the same BIG FUN Heiwajima complex — a natural hot spring drawn from 2,000m underground, known for its sodium-chloride water and high-concentration carbonated bath, plus a rock-bed sauna and massage services. Easy to fit in before or after a race.",
        url: "https://www.heiwajima-onsen.jp/",
      },
      {
        name: "Tondemi Heiwajima (indoor athletic park)",
        description:
          "Trampolines, a climbing wall and rope courses in the same complex — good for families with kids to burn off energy between races.",
      },
      {
        name: "Shinagawa Aquarium",
        description:
          "A mid-size aquarium known for its dolphin and sea lion shows and a 360-degree seal tank, inside Shinagawa Ward Citizens' Park near Omori-Kaigan Station — about 10 minutes by train from the venue.",
        lat: 35.58763655,
        lng: 139.73533342,
      },
      {
        name: "Omori Furusato-no-Hamabe Park",
        description:
          "One of the few 23-ward parks with a real sandy beach and tidal flats — you can wade in and spot crabs at low tide. The on-site Omori Nori Museum has an observation deck over Tokyo Bay. About 15 minutes on foot from the venue.",
        lat: 35.57302718,
        lng: 139.7422028,
      },
      {
        name: "Haneda Airport",
        description:
          "About 20-30 minutes by Keikyu Line — Terminal 3's Edo Koji recreates an Edo-period streetscape and has duty-free shopping, making it an easy last stop before or after a flight.",
        lat: 35.544982,
        lng: 139.769184,
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
    mapQuery: "ボートレース住之江",
    lat: 34.61166795,
    lng: 135.47127343,
    videoUrl: "https://www.youtube.com/channel/UCW3AReETO-oDmEoE-m3i7dQ",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the prepaid card "JUMPY CARD+", which you charge in advance; it also works as your entry pass at the gates.',
      url: "https://www.boatrace-suminoe.jp/sp/cashless.html",
    },
    facts: {
      water: "Freshwater pool",
      character: "Balanced racing; hosts many premier (SG/G1) events",
      nightRace: true,
    },
    tip: "Night races mean you can combine Osaka sightseeing by day with Kyotei by night — check our predictions for the evening card.",
    nearbyAttractions: [
      {
        name: "Sumiyoshi Taisha",
        description:
          "One of Japan's oldest and most important Shinto shrines, dedicated to the gods of the sea. Its arched Taiko-bashi bridge is a well-known landmark, and New Year's visits here are among the busiest in the Kansai region. About 20 minutes by train and subway from the venue.",
        url: "https://www.sumiyoshitaisha.net/",
        lat: 34.613379,
        lng: 135.493023,
      },
      {
        name: "ATC (Asia and Pacific Trade Center) & Suminoe Onsen SPA",
        description:
          "A large waterfront shopping complex about 6km west of the venue, with outlet stores, a home-goods mall and bay-view restaurants. Suminoe Onsen SPA, right by Suminoekoen Station, is where locals go to unwind with a hot bath after the races — easy to combine both in one trip.",
        lat: 34.6378236,
        lng: 135.41157189,
      },
      {
        name: "Namba & Shinsaibashi",
        description:
          "Osaka's biggest shopping and dining district, with department stores and traditional eateries lining Shinsaibashi-suji and the streets around Dotonbori. About 15 minutes away by metro — easy to fit in dinner and a walk after an evening card.",
        lat: 34.666438,
        lng: 135.495265,
      },
      {
        name: "Dotonbori",
        description:
          "Osaka's most iconic tourist strip, lined with oversized signs like the Glico running man and Kani Doraku's giant crab along the Dotonbori canal. Takoyaki, okonomiyaki and kushikatsu are all here — right next to Namba and Shinsaibashi, so pair them in one visit.",
        lat: 34.668516,
        lng: 135.502552,
      },
      {
        name: "Tsutenkaku Tower & Shinsekai",
        description:
          "Osaka's retro landmark tower and the old-school Shinsekai district around it, known for kushikatsu shops and Showa-era neon signage — a good dose of old Osaka atmosphere. About 10 minutes by metro from Namba, so it pairs well after Dotonbori.",
        url: "https://www.tsutenkaku.co.jp/",
        lat: 34.650935,
        lng: 135.505724,
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
    mapQuery: "ボートレース江戸川",
    lat: 35.69223896,
    lng: 139.86135473,
    videoUrl: "https://www.youtube.com/channel/UCpNAwETM_vPV2Skumzc_KMA",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the prepaid points card "Eメンバー" (E-Member), which earns 1.5 points per ¥100 wagered, redeemable for venue vouchers, reserved-seat tickets or gift cards.',
      url: "https://edogawa-emember.com/",
    },
    facts: {
      water: "River (tidal, affected by wind and current)",
      character: "The roughest water in Japan — expect upsets",
      nightRace: false,
    },
    tip: "Weather matters more here than anywhere else. Our AI factors venue volatility into every Edogawa prediction.",
    nearbyAttractions: [
      {
        name: "Kitaro Walkway (on-site)",
        description:
          "The venue's own embankment stands are lined with yokai artwork by Shigeru Mizuki, creator of GeGeGe no Kitaro — a one-of-a-kind sight you won't find at any other Kyotei venue.",
      },
      {
        name: "Kasai Rinkai Park & Aquarium",
        description:
          "Seaside park with a large aquarium built around a giant tuna tank, plus a giant Ferris wheel with bay views. About 30 minutes by train, and one stop further gets you to Tokyo Disney Resort.",
        lat: 35.64442524,
        lng: 139.86156763,
      },
      {
        name: "Tower Hall Funabori",
        description:
          "Edogawa Ward's landmark observation tower — a free 115m-high deck with views of Tokyo Skytree and, on clear days, Mt. Fuji. Right next to Funabori Station, an easy stop before or after a race.",
        url: "https://www.towerhall.jp/",
        lat: 35.684378,
        lng: 139.86496,
      },
      {
        name: "Gyosen Park & Shizen Zoo",
        description:
          "A free mini-zoo with 62 species including flamingos, meerkats and capybaras, plus a Japanese garden and fishing pond in the same park. About 15 minutes on foot from Nishi-Kasai Station — good for a family stop.",
        lat: 35.671505,
        lng: 139.858263,
      },
      {
        name: "Tokyo Disney Resort",
        description:
          "Japan's most famous theme park, one more stop past Kasai Rinkai Park on the JR Keiyo Line to Maihama Station. If your race is scheduled during the day, you can still fit in an evening at the park.",
        lat: 35.63626,
        lng: 139.88361,
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
    mapQuery: "ボートレース多摩川",
    lat: 35.658024,
    lng: 139.497068,
    videoUrl: "https://www.youtube.com/channel/UC4lvZQUptR8m5VDSu49xCGQ",
    cashless: {
      note: "The venue is cash-only for regular purchases — no credit cards. There's no branded cashless card here like at some other venues, but you can apply in person at the reserved-seat counter or Wakey Park 2F for a general prepaid card, chargeable in advance and usable for betting and entry; ¥100 wagered earns 1 point, redeemable for cash.",
      url: "https://www.boatrace-tamagawa.com/sp/index.php?page=service-cashless",
    },
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
          "JRA's major Fuchu racecourse is about a 14-minute walk away — a rare chance to see two very different kinds of Japanese racing in one trip. Meets usually run on weekends.",
        lat: 35.662493,
        lng: 139.485571,
      },
      {
        name: "Fuchu Station & Baba-Daimon Keyaki-namiki",
        description:
          "A roughly 500m avenue of old zelkova trees stretching from Fuchu Station's south exit, one of Tokyo's most distinctive tree-lined streets, with department stores and shopping streets nearby. Free race-day shuttle buses run here.",
        lat: 35.668992,
        lng: 139.477725,
      },
      {
        name: "Okunitama Shrine",
        description:
          "The chief Shinto shrine of the old Musashi Province and Fuchu's most important shrine, known for the lively Kurayami Festival each May — one of Tokyo's biggest traditional festivals. About 5 minutes on foot from Fuchu Station.",
        url: "https://www.ookunitamajinja.or.jp/",
        lat: 35.669633,
        lng: 139.479583,
      },
      {
        name: "Fuchu City Local History Museum & Park",
        description:
          "A sprawling 14-hectare outdoor museum with restored historic buildings, a planetarium and a large water-play pond. The plum grove is especially popular in February-March. About 20 minutes on foot from the venue.",
        lat: 35.656734,
        lng: 139.473216,
      },
      {
        name: "Suntory Musashino Beer Factory",
        description:
          "Suntory's first-ever beer factory, offering free brewing-process tours with tastings at the end (reservation required). About 15 minutes on foot from Fuchu-Honmachi Station — a good stop for beer fans.",
        url: "https://www.suntory.co.jp/factory/musashino/",
        lat: 35.66641531,
        lng: 139.47706333,
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
    mapQuery: "ボートレース福岡",
    lat: 33.599365,
    lng: 130.397081,
    videoUrl: "https://www.youtube.com/@boatracejpfukuoka",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the prepaid "Perabo Card", which doubles as a Rakuten Edy e-money card; charge it at the on-site machines before you bet.',
      url: "https://www.boatrace-fukuoka.com/sp/index.php?page=service-perabo",
    },
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
          "A large scenic park with a lake at its center and a roughly 2km loop path around it, plus a Japanese garden modeled on Suzhou-style gardens (entry ¥250, seasonal hours 9am-5pm or 9am-6pm, closed Mondays). About 4 minutes from Tenjin by subway to Ohorikoen Station — a good spot for a walk before or after racing.",
        url: "https://www.ohorikouen.jp/",
        lat: 33.586182,
        lng: 130.376188,
      },
      {
        name: "Maizuru Park & Fukuoka Castle Ruins",
        description:
          "Connected to Ohori Park, this park preserves the stone walls and watchtower ruins of Fukuoka Castle and is one of the city's best cherry-blossom spots. Free entry, and it's an easy pairing with Ohori Park on the same walk.",
        lat: 33.586043,
        lng: 130.383178,
      },
      {
        name: "Tenjin",
        description:
          "Fukuoka's main shopping, dining and nightlife district, with department stores, underground malls and izakaya, about 15 minutes on foot from the venue — easy to walk over for dinner after an evening card.",
        lat: 33.591426,
        lng: 130.399002,
      },
      {
        name: "Kego Shrine",
        description:
          "A shrine right in the middle of the Tenjin shopping district, founded in 1608 by Fukuoka's feudal lord Kuroda Nagamasa — a quiet stop to duck into after shopping. The adjacent Kego Park is a popular spot for locals to relax.",
        lat: 33.5877369,
        lng: 130.39996343,
      },
      {
        name: "Kushida Shrine",
        description:
          'Hakata\'s guardian shrine, affectionately called "O-Kushida-san", and the main stage of the July Hakata Gion Yamakasa festival — its colorful festival floats are on display year-round. About 10 minutes on foot from Nakasu.',
        lat: 33.5929546,
        lng: 130.4104589,
      },
      {
        name: "Nakasu Yatai Food Stalls",
        description:
          "Fukuoka's iconic street-food alley along the Naka river, with stalls opening from around 6pm on clear evenings and staying open late. Ramen, oden and grilled skewers are all here — pull up a seat at the counter and chat with the owner. An easy stop after an evening race.",
        lat: 33.595235,
        lng: 130.402559,
      },
      {
        name: "Canal City Hakata",
        description:
          "A large shopping complex built around an artificial canal, with a cinema, theater and dozens of restaurants, plus a nightly fountain show. About 5 minutes on foot from the Nakasu food stalls.",
        url: "https://canalcity.co.jp/",
        lat: 33.596269,
        lng: 130.410857,
      },
      {
        name: "On-site dining & the ROKU premium viewing lounge",
        description:
          'The venue itself is worth lingering at: the "Perabo Manju" bun on the 2F grandstand is a signature snack, and the conger-eel rice bowl at the 3F restaurant gets consistently good reviews. The standalone ROKU lounge outside offers café-style seating while you watch the races, plus a kids\' play area — good for a relaxed afternoon with family or a date.',
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
    mapQuery: "ボートレース桐生",
    lat: 36.39642168,
    lng: 139.30845653,
    videoUrl: "https://www.youtube.com/@boatracejpkiryu",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the free "DK Card", chargeable at on-site machines; ¥100 wagered earns 1 point when using reserved seating.',
      url: "https://www.kiryu-kyotei.com/sp/index.php?page=about-question",
    },
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
          "A preserved historic textile district with saw-tooth roof factories — Kiryu has been a major silk weaving town for 400 years. The Yurinkan storehouse complex at its southern end is the area's centerpiece.",
        lat: 36.416606,
        lng: 139.34303,
      },
      {
        name: "Orimono Sankokan Textile Museum",
        description:
          "A museum dedicated to Kiryu's textile heritage, with working looms on display inside the Shinmachi weaving district — a good pairing with a walk through the historic streets.",
      },
      {
        name: "Kiryu Tenmangu Shrine",
        description:
          "The shrine that Kiryu Shinmachi grew up around roughly 400 years ago, still the town's spiritual center today and host to an antiques market on the 25th of most months.",
        lat: 36.422137,
        lng: 139.34634,
      },
      {
        name: "Kiryu Station area",
        description:
          "The city's main train station and the surrounding shopping streets, connecting the venue to Shinmachi and the rest of central Kiryu.",
        lat: 36.41102148,
        lng: 139.33332328,
      },
      {
        name: "Kiryugaoka Park (zoo & amusement park)",
        description:
          "A free city park combining a small zoo (giraffes, lions, elephants and more) with an amusement park — a relaxed family outing about 15 minutes on foot from Kiryu Station.",
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
    mapQuery: "ボートレース戸田",
    lat: 35.801908,
    lng: 139.676807,
    videoUrl: "https://www.youtube.com/channel/UCoLCf3aVRMSukwetHfn1p1A",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the "WINWIN Card", which also supports a markless betting app; ¥200 wagered earns 1 point, redeemable for e-money cashback.',
      url: "https://www.boatrace-toda.jp/service/cashless.html",
    },
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
          "The 1964 Olympic rowing course itself, right where the venue sits, now a public park with cherry blossoms along the Arakawa riverbank in spring.",
      },
      {
        name: "Kamitoda Hikawa Shrine",
        description:
          "A local Shinto shrine about 1.5km from the venue, worth a quiet stop if you're walking or cycling the riverside paths near Toda-Koen Station.",
        lat: 35.813919,
        lng: 139.675218,
      },
      {
        name: "Todabashi Bridge & Arakawa Riverside",
        description:
          "A historic road bridge over the Arakawa river connecting Saitama and Tokyo, with a riverside green space nearby that hosts fireworks displays in summer. About 15 minutes on foot from the venue.",
        lat: 35.798526,
        lng: 139.660923,
      },
      {
        name: "Saiko Lake & Domitsu Green Park",
        description:
          "A large reservoir-turned-park along the Arakawa, popular for cycling, fishing and windsurfing, with a protected wild primrose habitat. About 3km from the venue.",
        lat: 35.825039,
        lng: 139.63012303,
      },
      {
        name: "BOAT KIDS PARK Morvi Toda (on-site)",
        description:
          "A family-friendly play area inside the venue with photo-ready boat displays — an easy stop between races if you're bringing kids.",
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
    mapQuery: "ボートレース浜名湖",
    lat: 34.698504,
    lng: 137.57206,
    videoUrl: "https://www.youtube.com/channel/UCGZig6i5JrZ33jjW2GG6Bzw",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the free "Hamana Po!" IC card, which you charge at on-site machines; ¥100 wagered earns 1 point, redeemable for cash or venue goods.',
      url: "https://www.boatrace-hamanako.jp/sp/index.php?page=service-point",
    },
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
          "A hot-spring resort town on the eastern lakeshore, known for eel (unagi) cuisine and lake-view baths. About 40 minutes from the venue by car, on the opposite side of Lake Hamana.",
        lat: 34.763229,
        lng: 137.615619,
      },
      {
        name: "Hamanako Parupal (amusement park)",
        description:
          "A lakeside amusement park with around 25 rides right in Kanzanji, a popular family day-trip spot that pairs well with the onsen town.",
        lat: 34.763229,
        lng: 137.615619,
      },
      {
        name: "Hamanako Garden Park",
        description:
          "A large prefectural park on the lake's south shore with flower gardens and open lawns, once the site of a national flower expo. About 15 minutes from the venue by car.",
        lat: 34.714473,
        lng: 137.600915,
      },
      {
        name: "Arai Checkpoint (Arai Sekisho)",
        description:
          "Japan's only surviving Edo-period checkpoint building on the old Tokaido road, now a museum — a short trip from the venue since both sit in the same Arai district.",
        lat: 34.694906,
        lng: 137.561779,
      },
      {
        name: "Hamamatsu Flower Park",
        description:
          "A large flower theme park with seasonal displays year-round, about 12 minutes by car north of Hamanako Garden Park.",
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
    mapQuery: "ボートレース蒲郡",
    lat: 34.82390294,
    lng: 137.20574497,
    videoUrl: "https://www.youtube.com/channel/UCZhuyNQgLORLjgl8hlA7uHw",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the free "e-jan Card" at the 1F information counter; ¥100 spent on tickets, entry or reserved seating earns 1 point, redeemable for cash or goods, and card holders can also bet from a free smartphone app.',
      url: "https://gama-win.com/card/about/index.html",
    },
    facts: {
      water: "Freshwater pool — calm and fast, sheltered from wind",
      character:
        "Lane 1 wins often, but center-lane comebacks are common at mark 2",
      nightRace: true,
    },
    tip: "Fast, sheltered water raises the value of a clean start here — our AI weighs start-timing data heavily in every Gamagori prediction.",
    nearbyAttractions: [
      {
        name: "Takeshima Island & Yaotomi Shrine",
        description:
          "Gamagori's symbol — a small sacred island reached by a 387m bridge, home to Yaotomi Shrine, one of Japan's Seven Benzaiten shrines. The island itself is a designated natural monument for its plant life.",
        lat: 34.811002,
        lng: 137.231683,
      },
      {
        name: "Takeshima Aquarium",
        description:
          "A compact, quirky aquarium right by Takeshima Island, known for showcasing rare and unusual deep-sea creatures alongside the usual favorites.",
        lat: 34.811002,
        lng: 137.2325,
      },
      {
        name: "Laguna Ten Bosch",
        description:
          "A seaside resort with a theme park, outlet shopping and dining, about 15 minutes by free shuttle bus from JR Gamagori station.",
        lat: 34.808775,
        lng: 137.271339,
      },
      {
        name: "Mitsuya Onsen",
        description:
          "A hot-spring district on Mikawa Bay, unusual for offering four different spring types in one small area — a relaxed stop before or after racing.",
      },
      {
        name: "Gamagori Classic Hotel",
        description:
          "A prewar Western-style hotel on a hilltop across the bay from Takeshima Island, worth a look even if you're not staying, for its retro architecture and sea views.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/gamagori.jpg",
      alt: "Boat Race Gamagori central gate",
      credit: "Photo by A301m089, public domain, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:20080719_Gamagori_kyotei_Central_Gate.jpg",
    },
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
    mapQuery: "ボートレースとこなめ",
    lat: 34.88566429,
    lng: 136.8324971,
    videoUrl: "https://www.youtube.com/channel/UCu9lPbAk1MosTGm2yQ4BapQ",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the free "TOKOCA" card, issued same-day; ¥200 wagered earns 1 point, redeemable for cash toward tickets or entry.',
      url: "https://tokoname-mania.com/card/",
    },
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
          "A historic ceramics district with brick kiln chimneys and craft studios along a roughly 1.6km walking course, starting from the Ceramic Museum about 5 minutes from Tokoname station.",
        lat: 34.89056,
        lng: 136.83556,
      },
      {
        name: "Tokoname Maneki-neko Street",
        description:
          'A wall lined with 39 ceramic lucky cats made by local potters, watched over by "Tokonyan", a giant 6.3m beckoning cat peeking over the wall — one of Tokoname\'s most photographed spots, on the way to the pottery museum.',
        lat: 34.89056,
        lng: 136.83656,
      },
      {
        name: "INAX Live Museum",
        description:
          "A museum complex covering the history of tiles and ceramics, including a preserved brick kiln you can walk inside — a good complement to a walk through the pottery district.",
      },
      {
        name: "Chubu Centrair International Airport",
        description:
          "Just across the bay from the venue — an easy combination with a flight before or after racing, with an observation deck if you just want to watch planes.",
        lat: 34.85833,
        lng: 136.80528,
      },
      {
        name: "Rinku Beach",
        description:
          "A white-sand artificial beach right by the venue, popular in summer and known for sunset views over the bay toward Centrair Airport.",
        lat: 34.886178,
        lng: 136.822708,
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
    mapQuery: "ボートレース津",
    lat: 34.681031,
    lng: 136.518254,
    videoUrl:
      "https://www.youtube.com/@%E3%83%AC%E3%83%BC%E3%82%B9LIVE%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E6%B4%A5%E3%81%85%E5%85%AC%E5%BC%8F",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the "Tsukki Card", charge it in advance, and winnings are credited automatically so you can head straight to the next race without a payout line.',
      url: "https://www.boatrace-tsu.com/",
    },
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
      {
        name: "Yuki Shrine",
        description:
          "A shrine famous for around 300 weeping plum trees, known as \"Yuki-san's weeping plums\", in full bloom from mid-February to mid-March — one of the region's best plum-viewing spots.",
        lat: 34.697693,
        lng: 136.515215,
      },
      {
        name: "Tsu Castle Ruins (Oshiro Park)",
        description:
          "The ruins of a castle rebuilt by the famed castle architect Todo Takatora, now a park preserving part of the main keep, moat and turret — a quiet historical stop in the city center.",
        lat: 34.717973,
        lng: 136.507393,
      },
      {
        name: "Mie Prefectural Museum (MieMu)",
        description:
          "The prefecture's flagship museum covering Mie's natural history, culture and industry, with hands-on exhibits that work well for families.",
        lat: 34.742185,
        lng: 136.501689,
      },
      {
        name: "Tsu Kannon Temple & Daimon district",
        description:
          "One of Japan's three great Kannon temples, at the heart of the Daimon shopping and dining district — Tsu's original birthplace of the tenmusu rice ball, a local specialty worth trying nearby.",
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
    mapQuery: "ボートレース三国",
    lat: 36.23277732,
    lng: 136.18537486,
    videoUrl: "https://www.youtube.com/channel/UCu-yP6WJQ0zcx5nmWhxvJEg",
    cashless: {
      note: 'The venue has no cashless betting system as of 2026 — all purchases are cash-only. There is a free loyalty points program, the "Mikuni Boat Point Card", but it only tracks points, not betting balance.',
      url: "https://www.boatrace-mikuni.jp/sp/index.php?page=service-pointcard",
    },
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
          "Dramatic basalt sea cliffs stretching about a kilometer along the coast, ranked among Japan's most scenic spots and known for their unusual hexagonal rock columns.",
        lat: 36.23778,
        lng: 136.12528,
      },
      {
        name: "Mikuni-minato",
        description:
          "A historic Kitamae-bune trading port with a preserved old town of merchant houses and fresh seafood, including crab in season, about 5 minutes from Mikuni station.",
      },
      {
        name: "Mikuni Shrine",
        description:
          'Home of the Mikuni Festival, one of the Hokuriku region\'s three major festivals, held every May with six giant floats — the shrine itself, nicknamed "Osan-no-san", is worth a visit year-round.',
        lat: 36.20599,
        lng: 136.16072,
      },
      {
        name: "Awara Onsen",
        description:
          "One of Fukui's best-known hot spring towns, with dozens of ryokan and public baths, about 10 minutes from the venue by free shuttle bus toward Awara-Onsen station.",
        lat: 36.21456164,
        lng: 136.23503542,
      },
      {
        name: "Maruoka Castle",
        description:
          "One of Japan's oldest surviving original castle keeps, dating to the 16th century, on a hill with cherry trees that draw crowds in spring. About a 25-minute drive from the venue.",
        lat: 36.152363,
        lng: 136.272073,
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/mikuni.jpg",
      alt: "Boat Race Mikuni stadium",
      credit: "Photo by SONIC BLOOMING, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Boat_Race_Mikuni.jpg",
    },
  },
  {
    slug: "biwako",
    code: 11,
    name: "Biwako",
    kanji: "びわこ",
    region: "Shiga",
    regionGroup: "kinki",
    tagline: "Japan's most scenic venue, on the shore of Lake Biwa",
    intro: [
      'Boat Race Biwako sits on the shore of Lake Biwa, Japan\'s largest freshwater lake, with views across the water to Mt. Mikami ("Omi-Fuji") and Mt. Ibuki that make it one of the most scenic Kyotei venues in the country. A sightseeing paddle steamer, the Michigan, is often visible cruising the lake during racing.',
      "Spring and summer bring offshore winds that can roughen the water, so conditions vary more here than at fully sheltered venues — a factor worth watching alongside the view.",
    ],
    access: [
      'Keihan "Bessho" station → about 9 minutes on foot',
      "By car: about 15 minutes from Otsu or Kyoto-Higashi interchanges on the Meishin Expressway",
    ],
    mapQuery: "ボートレースびわこ",
    lat: 35.01730116,
    lng: 135.86110332,
    videoUrl: "https://www.youtube.com/channel/UCLbcsJqsT5Qa1axpYcOBpmg",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for "Bina Touch"; there is also a shared loyalty program, "Ohmi Point Club", where points earned here also count at Mikuni, Suminoe and Amagasaki.',
      url: "https://www.boatrace-biwako.jp/modules/service/?page=index_point",
    },
    facts: {
      water:
        "Freshwater (Lake Biwa) — can roughen with offshore wind in spring/summer",
      character:
        "One of the most scenic venues in Japan; conditions vary with wind",
      nightRace: false,
    },
    tip: "Wind off the lake can shift conditions mid-card here — our AI factors venue volatility into every Biwako prediction.",
    nearbyAttractions: [
      {
        name: "Lake Biwa waterfront",
        description:
          "Sweeping views of Mt. Mikami and Mt. Ibuki across the water right by the venue, with sightseeing boats like the paddle steamer Michigan cruising the lake.",
      },
      {
        name: "Mii-dera Temple",
        description:
          "One of Japan's four great temples, with a bell famed as one of the country's finest-sounding — a UNESCO World Heritage tentative site, about 1km from the venue.",
        lat: 35.01335,
        lng: 135.852822,
      },
      {
        name: "Lake Biwa Canal (Biwako Sosui)",
        description:
          "A 19th-century canal connecting Lake Biwa to Kyoto, with a cherry-lined walking path along the water — a scenic stroll near Mii-dera.",
        lat: 35.012481,
        lng: 135.858029,
      },
      {
        name: "Omi Jingu Shrine",
        description:
          "A shrine dedicated to Emperor Tenji, set in a forested hillside and known for hosting Japan's national karuta card game championships — about a 20-minute drive from the venue.",
        lat: 35.032216,
        lng: 135.852109,
      },
      {
        name: "Nagisa Park & Otsu lakefront",
        description:
          "A long lakeside park with seasonal flowers (moss phlox in spring), near the Biwako Otsu Prince Hotel — a relaxed lakefront walk about 15 minutes south of the venue.",
        lat: 35.004965,
        lng: 135.889099,
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/biwako.jpg",
      alt: "Boat Race Biwako stadium on Lake Biwa",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Biwako-kyotei-01.jpg",
    },
  },
  {
    slug: "amagasaki",
    code: 13,
    name: "Amagasaki",
    kanji: "尼崎",
    region: "Hyogo",
    regionGroup: "kinki",
    tagline:
      "Step off the train and you're there — one of the calmest waters in Japan",
    intro: [
      'Boat Race Amagasaki is about as convenient as Kyotei gets: the venue sits right next to Hanshin Railway\'s "Amagasaki Center Pool-mae" station, so you barely need an umbrella even on a rainy day. The water here is known as one of the calmest and most technical in the sport, freshwater and firm underneath the hull.',
      "A headwind blows across the course most of the year, though it can swing to a tailwind when a low-pressure system or rain moves in. In recent years lane 1 has been winning more than 60% of the time here, making Amagasaki one of the most inside-favored venues in Japan.",
    ],
    access: [
      'Hanshin Railway "Amagasaki Center Pool-mae" station → right next to the venue',
      'Direct limited express or express trains from Osaka-Umeda, or transfer to local service at "Nishinomiya" from Kobe-Sannomiya',
    ],
    mapQuery: "ボートレース尼崎",
    lat: 34.719489,
    lng: 135.393973,
    videoUrl: "https://www.youtube.com/@AMABOATRACE",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the free "AMA+" card, chargeable at on-site machines; ¥100 wagered earns 1 point, redeemable for reserved-seat tickets, QUO cards or venue goods.',
      url: "https://www.boatrace-amagasaki.jp/sp/index.php?page=service-cashless",
    },
    facts: {
      water: "Freshwater, firm and calm — technique-friendly",
      character:
        "One of the most inside-favored venues in Japan (lane 1 wins 60%+)",
      nightRace: false,
    },
    tip: "With lane 1 winning this often, our AI weighs start-course strength especially heavily in every Amagasaki prediction.",
    nearbyAttractions: [
      {
        name: "Amagasaki Castle",
        description:
          "A rebuilt Edo-period castle (reopened 2019) on the site of the original, with a museum inside covering the castle town's history — about 2km from the venue.",
        lat: 34.716723,
        lng: 135.41875,
      },
      {
        name: "Jicho-machi Temple District",
        description:
          "A historic quarter of eleven temples right by Amagasaki Castle, preserving the look of the old castle town — a quiet contrast to the racing.",
      },
      {
        name: "Amagasaki Piggy Bank Museum",
        description:
          "A quirky company museum run by a local credit union, displaying thousands of piggy banks from around the world — an easy pairing with the castle and temple district nearby.",
        lat: 34.716214,
        lng: 135.413431,
      },
      {
        name: "Shioe Susanoo Shrine",
        description:
          "A local Shinto shrine known for its summer festival, a quiet stop if you're exploring the area around Hanshin Amagasaki Station.",
        lat: 34.737332,
        lng: 135.435484,
      },
      {
        name: "Hanshin Amagasaki Station area",
        description:
          "The city's main train hub, with shopping streets and the recently renewed Chuo Park nearby — a convenient base if you're combining a race visit with sightseeing elsewhere in the city.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Amagasaki races about 180 days a year, more than most venues. Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/amagasaki.jpg",
      alt: "Boat Race Amagasaki stadium",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Amagasaki-kyotei-01.jpg",
    },
  },
  {
    slug: "naruto",
    code: 14,
    name: "Naruto",
    kanji: "鳴門",
    region: "Tokushima",
    regionGroup: "shikoku",
    tagline: "Wide-open, upset-friendly water next to the famous whirlpools",
    intro: [
      "Boat Race Naruto sits on the Konaruto Strait in Tokushima, close enough to the stands that races feel unusually intense to watch live. A breakwater keeps the seawater course calm despite its coastal setting, but lane 1 is weak here — any lane can win, upsets are common, and payouts run high, making Naruto a favorite for bettors who chase long shots.",
      "The venue operates up to 360 days a year with tickets on sale from early morning to about 8:30pm, including night racing, so there's almost always a card running.",
    ],
    access: [
      'JR "Naruto" station → about 10 minutes on foot',
      'Bus from JR Naruto station or Tokushima Airport → get off at "Kosoku Naruto" stop',
    ],
    mapQuery: "ボートレース鳴門",
    lat: 34.190725,
    lng: 134.609646,
    videoUrl: "https://www.youtube.com/channel/UCd8rJfg7p8qsASOEIIwAinQ",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the "Naru-chan e-CLUB" card; ¥200 wagered earns 1 point, reserved-seat fees get a 10% discount when paid with the card, and winnings carry over on the card day to day.',
      url: "https://www.n14.jp/sp/index.php?page=service-cashless",
    },
    facts: {
      water:
        "Seawater, sheltered by a breakwater — calm despite the coastal setting",
      character:
        "Lane 1 is weak — any lane can win; upsets and high payouts are common",
      nightRace: true,
    },
    tip: "With lane 1 this weak, our AI weighs every lane's chances more evenly here than at almost any other venue.",
    nearbyAttractions: [
      {
        name: "Naruto Whirlpools (Uzushio)",
        description:
          "Some of the world's largest tidal whirlpools, best seen up close on a sightseeing boat from Uzushio Kisen, or from the Onaruto Bridge's pedestrian walkway, Uzu-no-Michi.",
      },
      {
        name: "Naruto Park & Senjojiki Observatory",
        description:
          "A clifftop park overlooking the whirlpools and the Onaruto Bridge, with an observation deck and a cluster of restaurants and souvenir shops.",
      },
      {
        name: "Otsuka Museum of Art",
        description:
          "A museum of full-size ceramic reproductions of world masterpieces, from Michelangelo's Sistine Chapel to Monet's water lilies — one of Japan's largest art museums by floor space.",
        lat: 34.23203,
        lng: 134.637815,
      },
      {
        name: "Naruto Germany Hall",
        description:
          "A museum on the site of a WWI POW camp where German prisoners famously performed Japan's first complete Beethoven's Ninth Symphony — an unusual piece of local history.",
        lat: 34.164678,
        lng: 134.499038,
      },
      {
        name: "Roadside Station Kurukuru Naruto",
        description:
          "A modern roadside market with local produce, seafood and dining, opened in 2022 — a convenient stop for food on the way to or from the venue.",
        lat: 34.158134,
        lng: 134.580155,
      },
    ],
    schedule: {
      typicalRaceDays:
        "One of the most active venues in Japan, racing up to 360 days a year with both day and night meets.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/naruto.jpg",
      alt: "Boat Race Naruto stadium",
      credit: "Photo by Na00ru0010, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Naruto-kyotei-01.jpg",
    },
  },
  {
    slug: "marugame",
    code: 15,
    name: "Marugame",
    kanji: "丸亀",
    region: "Kagawa",
    regionGroup: "shikoku",
    tagline: "A tide-driven Seto Inland Sea course, in Japan's udon capital",
    intro: [
      'Boat Race Marugame faces the Seto Inland Sea in Kagawa prefecture, on a soft, buoyant seawater course with one of the strongest tidal swings of any Kyotei venue — up to about 2 meters between high and low tide. A headwind is common, and passing moves like "sashi" and "makuri-sashi" succeed more often here than pure escapes.',
      'Marugame has raced under lights since its "Blue Nighter" night program launched in 2009, and is now a year-round night-racing venue.',
    ],
    access: [
      'JR Yosan Line "Marugame" station → free shuttle bus, about 10 minutes',
      "By car: about 15-20 minutes from Sakaide or Zentsuji interchanges on the Takamatsu or Seto-Chuo Expressways",
    ],
    mapQuery: "ボートレース丸亀",
    lat: 34.30469395,
    lng: 133.79470945,
    videoUrl: "https://www.youtube.com/channel/UC2CWDMG18mpBGXkI9KHdACQ",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the "B Card"; ¥100 wagered earns 1 point, and reserved-seat prices are discounted (typically half price) when paid with the card.',
      url: "https://www.marugameboat.jp/sp/pointcard.htm",
    },
    facts: {
      water: "Seawater, Seto Inland Sea — strong tidal swing (up to ~2m)",
      character:
        "Passing moves (sashi, makuri-sashi) succeed more than pure escapes",
      nightRace: true,
    },
    tip: "The tide here genuinely changes the water through the card — our AI factors tidal timing into every Marugame prediction.",
    nearbyAttractions: [
      {
        name: "Marugame Castle",
        description:
          "A 400-year-old castle with one of Japan's 12 surviving original wooden keeps, famous for its dramatic curved stone walls and Japan's tallest existing stone castle ramparts.",
        lat: 34.286115,
        lng: 133.800334,
      },
      {
        name: "Marugame udon",
        description:
          "The city is one of Japan's udon capitals — a short walk from the venue turns up several well-known noodle shops.",
      },
      {
        name: "Marugame Genichiro-Inokuma Museum of Contemporary Art (MIMOCA)",
        description:
          "A striking modern building facing JR Marugame station, showcasing the work of Kagawa-born artist Genichiro Inokuma alongside contemporary exhibitions.",
        lat: 34.291214,
        lng: 133.792025,
      },
      {
        name: "Nakazu Banshoen Garden & Uchiwa Museum",
        description:
          "A traditional Edo-period strolling garden with a teahouse, now also home to the relocated Marugame Uchiwa (fan) Museum — Marugame makes about 90% of Japan's traditional paper fans.",
        lat: 34.285108,
        lng: 133.769663,
      },
      {
        name: "Marugame Port",
        description:
          "The city's historic harbor, once a key Edo-period trading port, with ferries still running to nearby Shodoshima and Honjima islands.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "A year-round night-racing venue since 2009. Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/marugame.jpg",
      alt: "Boat Race Marugame stadium",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Marugame-kyotei-02.jpg",
    },
  },
  {
    slug: "kojima",
    code: 16,
    name: "Kojima",
    kanji: "児島",
    region: "Okayama",
    regionGroup: "chugoku",
    tagline: "Calm water in the shadow of the Great Seto Bridge",
    intro: [
      "Boat Race Kojima sits on the Seto Inland Sea in Kurashiki, right by the Great Seto Bridge, with views of the bridge and the sea's scattered islands from the stands. Tides here swing significantly, but wind is usually light, so races tend to stay calm and readable rather than chaotic.",
      "Kojima is also Japan's denim capital: the venue is a short trip from Kojima Jeans Street, where dozens of shops sell jeans made in local mills — an easy pairing with a day at the races.",
    ],
    access: [
      'JR Seto-Ohashi Line "Kojima" station → free shuttle bus, 3-5 minutes',
      "By car: about 5 minutes from Kojima IC on the Seto-Chuo Expressway",
    ],
    mapQuery: "ボートレース児島",
    lat: 34.44852433,
    lng: 133.80919362,
    videoUrl: "https://www.youtube.com/channel/UC6IrOXVuw6xXLl1qJqYUrsg",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the free "K Smart Card"; ¥100 wagered earns 1 point (more at reserved seating), redeemable for e-money or venue goods, and usable at the off-track facility too.',
      url: "https://www.kojimaboat.jp/cashless.html",
    },
    facts: {
      water:
        "Seawater, Seto Inland Sea — strong tidal swing, usually light wind",
      character: "Tide-driven but generally calm and readable",
      nightRace: false,
    },
    tip: "With wind rarely a factor, tide timing does most of the work here — our AI tracks it closely for every Kojima prediction.",
    nearbyAttractions: [
      {
        name: "Kojima Jeans Street",
        description:
          "A roughly 400m shopping street in the Ajino district lined with shops selling locally made denim — Kojima is considered Japan's jeans-making capital, and this is its most concentrated stretch of shops.",
      },
      {
        name: "Kyu-Nozaki-ke Residence",
        description:
          "A vast Edo-period merchant estate built by a salt-trading magnate, with roughly 1,000 tsubo of buildings preserved as a museum — a striking contrast to the modern jeans stores nearby.",
      },
      {
        name: "Shimotsui Port & Castle Ruins",
        description:
          "A historic fishing port with the ruins of Shimotsui Castle on the hill behind it, now part of a memorial park for the Great Seto Bridge — cherry blossoms in spring.",
        lat: 34.43678,
        lng: 133.797712,
      },
      {
        name: "Washuzan Observatory",
        description:
          "A hilltop lookout with sweeping views over the Seto Inland Sea and the Great Seto Bridge, especially striking at sunset.",
        lat: 34.434429,
        lng: 133.813915,
      },
      {
        name: "Great Seto Bridge sightseeing cruise",
        description:
          "A roughly 45-minute cruise under the bridge, departing from Kojima's sightseeing port.",
        lat: 34.43678,
        lng: 133.797712,
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/kojima.jpg",
      alt: "Boat Race Kojima stadium",
      credit: "Photo by 計記録, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Kojima-kyotei-01.jpg",
    },
  },
  {
    slug: "miyajima",
    code: 17,
    name: "Miyajima",
    kanji: "宮島",
    region: "Hiroshima",
    regionGroup: "chugoku",
    tagline:
      "One of the most technical waters in Japan, facing Miyajima Island",
    intro: [
      "Boat Race Miyajima sits right next to the ferry pier for Miyajima Island, and on a clear day the stands look out over passing ferries and the torii gate of UNESCO World Heritage-listed Itsukushima Shrine — one of the more striking views in the sport. The Seto Inland Sea water here is considered one of the most technical in Japan.",
      "A tidal swing of over 4 meters transforms the course through the day: at low tide the breakwater blocks the wind for easy racing, while at high tide the water gets choppy and races bunch up. Wind direction often flips between morning and afternoon, which can throw off starts.",
    ],
    access: [
      'JR "Miyajimaguchi" station → about 3 minutes on foot',
      "Hiroden Miyajima Line trams stop right at the venue on race days",
    ],
    mapQuery: "ボートレース宮島",
    lat: 34.315217,
    lng: 132.306522,
    videoUrl:
      "https://www.youtube.com/@%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E5%AE%AE%E5%B3%B6%E3%83%81%E3%83%A3%E3%83%B3%E3%83%8D%E3%83%AB%E5%85%AC%E5%BC%8F",
    cashless: {
      note: 'The venue is cash-only for regular purchases — no credit cards. For cashless betting, sign up for the "MOMIJI CARD", issued same-day; ¥200 wagered earns 1 point, and card holders get free access to the desk seating in the 3F "Momiji" section.',
      url: "https://www.boatrace-miyajima.com/momiji_card.html",
    },
    facts: {
      water:
        "Seawater, Seto Inland Sea — over 4m tidal swing, one of Japan's most technical courses",
      character:
        "Calm at low tide, choppy and bunched at high tide; starts can be uneven",
      nightRace: false,
    },
    tip: "Tide state matters more here than almost anywhere else — our AI weighs it heavily in every Miyajima prediction.",
    nearbyAttractions: [
      {
        name: "Miyajimaguchi Ferry Terminal",
        description:
          "The mainland ferry pier right by the venue, with frequent crossings to Miyajima Island taking about 10 minutes — the easiest way to combine a race visit with the island.",
        lat: 34.3112306,
        lng: 132.3052806,
      },
      {
        name: "Itsukushima Shrine",
        description:
          "A UNESCO World Heritage shrine famous for its floating torii gate, built out over the water on Miyajima Island, a short ferry ride from the venue.",
        lat: 34.295922,
        lng: 132.319816,
      },
      {
        name: "Five-storied Pagoda & Senjokaku Hall",
        description:
          "A vividly painted 1407 pagoda standing next to Senjokaku, a huge unfinished wooden hall built by Toyotomi Hideyoshi — both overlook Itsukushima Shrine from a small hill nearby.",
        lat: 34.29272654861169,
        lng: 132.32234728742426,
      },
      {
        name: "Miyajima Aquarium (Miyajima Marine)",
        description:
          "A city-run aquarium focused on Seto Inland Sea marine life, with finless porpoises, sea lions and penguins — a good option if you're visiting with kids.",
      },
      {
        name: "Momijidani Park",
        description:
          "A maple valley park below Mt. Misen, one of Japan's most famous autumn-leaf spots, with a ropeway station nearby for those wanting to hike or ride up the mountain.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/miyajima.jpg",
      alt: "Boat Race Miyajima stadium",
      credit: "Photo by Ujinaport, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Miyajima_Kyotei_01.jpg",
    },
  },
  {
    slug: "tokuyama",
    code: 18,
    name: "Tokuyama",
    kanji: "徳山",
    region: "Yamaguchi",
    regionGroup: "chugoku",
    tagline: "A tide-driven course on Kasado Bay, framed by mountain views",
    intro: [
      "Boat Race Tokuyama faces Kasado Bay in Yamaguchi prefecture, with Mt. Takaayama rising behind the stands and the Seto Inland Sea stretching out in front. It's also a year-round morning-racing venue — the first race sets off around 8:32am, and the card wraps up by early afternoon.",
      "A diagonal tailwind is common, and the tide swings more than 3 meters, splitting racing into two distinct styles through the day: at low tide it becomes a power race, rewarding strong motors; at high tide, handling and finesse matter more as the water gets trickier to read.",
    ],
    access: [
      'JR "Kushigahama" station is the nearest train station',
      'Free taxi service from JR Tokuyama station\'s "Minato-guchi" exit, about 20 minutes, from 7:45am',
    ],
    facts: {
      water: "Seawater, Kasado Bay — tidal swing over 3m",
      character: "Power race at low tide, handling race at high tide",
      nightRace: false,
    },
    tip: "Because low and high tide play so differently here, our AI checks tide timing alongside motor and handling data for every Tokuyama prediction.",
    nearbyAttractions: [
      {
        name: "Tokuyama Zoo",
        description:
          "A small city zoo a short trip from the venue, popular with families.",
      },
      {
        name: "Seto Inland Sea views",
        description:
          "The venue itself looks out over Kasado Bay with Mt. Takaayama behind — worth a moment even outside race hours.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "A year-round morning-racing venue. Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/tokuyama.jpg",
      alt: "Boat Race Tokuyama stadium",
      credit: "Photo by dora1977, public domain, via Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Tokuyamakyotei.JPG",
    },
  },
  {
    slug: "shimonoseki",
    code: 19,
    name: "Shimonoseki",
    kanji: "下関",
    region: "Yamaguchi",
    regionGroup: "chugoku",
    tagline: "A calm, LED-lit seawater pool at the tip of Honshu",
    intro: [
      "Boat Race Shimonoseki sits at the western tip of Honshu, with a seawater course built pool-style behind a raised breakwater — high enough that waves from the Suo Sea rarely get in, even at high tide. That keeps the water calm most of the time and reduces the impact of racers' weight differences, though a tide over 3 meters can still bring water in near the first mark.",
      'The course is lit by LED lighting that racers rate highly, and Shimonoseki has raced under lights year-round since 2017 — plus late-night "Midnight" boat racing since 2021, for some of the latest post times in the sport.',
    ],
    access: [
      '"Chofu" station is the nearest train station → about 10 minutes on foot to the main gate',
      "About 10 minutes from Shin-Shimonoseki station by taxi or bus",
    ],
    facts: {
      water:
        "Seawater pool (breakwater-sheltered) — generally calm, tide affects mark 1 when over 3m",
      character: "Calm and consistent most of the time",
      nightRace: true,
    },
    tip: "Stable, well-lit conditions make this one of the more consistent venues to read — our AI still checks tide state near the first mark for every Shimonoseki prediction.",
    nearbyAttractions: [
      {
        name: "Karato Market",
        description:
          "A famous fugu (pufferfish) and seafood market, with weekend food stalls selling sushi and seafood bowls.",
      },
      {
        name: "Shimonoseki Kaikyokan Aquarium",
        description:
          "An aquarium overlooking the Kanmon Strait with the world's largest collection of pufferfish species.",
      },
    ],
    schedule: {
      typicalRaceDays:
        'A year-round night-racing venue since 2017, with late-night "Midnight" boat racing since 2021.',
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/shimonoseki.jpg",
      alt: "Boat Race Shimonoseki stadium",
      credit: "Photo by Muyo, CC BY-SA 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Shimonoseki_Kyotei.jpg",
    },
  },
  {
    slug: "wakamatsu",
    code: 20,
    name: "Wakamatsu",
    kanji: "若松",
    region: "Fukuoka (Kyushu)",
    regionGroup: "kyushu",
    tagline: "The birthplace of the All-Japan Championship, on Dokai Bay",
    intro: [
      'Boat Race Wakamatsu sits on Dokai Bay in Kitakyushu, and is known as the "birthplace of the Derby" — the first All-Japan Championship was held here. The seawater course connects directly to the bay near the second mark, so tide and wind can flow in from that side, though the water is generally calmer than the rougher venues in the sport.',
      'Wakamatsu is also famous for being the closest pair of venues in Japan: Boat Race Ashiya is a short trip away, and some fans "hop" between the two, catching one card in the morning and another later in the day.',
    ],
    access: ['"Okudokai" station → about 5 minutes on foot'],
    facts: {
      water:
        "Seawater, connects to Dokai Bay near mark 2 — generally calm, some winter roughness",
      character: "Balanced water with both calm and technical traits",
      nightRace: true,
    },
    tip: "Conditions here sit between calm and technical — our AI weighs both start data and venue volatility for every Wakamatsu prediction.",
    nearbyAttractions: [
      {
        name: "Shabon Dama Soap factory tour",
        description:
          "A free factory tour at the well-known Japanese soap maker, a short trip from the venue.",
      },
      {
        name: "Moly Fantasy Wakamatsu",
        description:
          "An indoor amusement arcade inside the nearby Aeon Wakamatsu shopping center — good for a rainy day.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/wakamatsu.jpg",
      alt: "Boat Race Wakamatsu, near Okudokai station",
      credit: "Photo by そらみみ, CC BY-SA 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Boat_Race_Wakamatsu_in_front_of_Okudokai_Station.jpg",
    },
  },
  {
    slug: "ashiya",
    code: 21,
    name: "Ashiya",
    kanji: "芦屋",
    region: "Fukuoka (Kyushu)",
    regionGroup: "kyushu",
    tagline: "A calm, technical freshwater course near the coast",
    intro: [
      "Boat Race Ashiya sits near the Onga River, about 2km from the Hibiki-nada sea. The course runs roughly east-west on a firm freshwater surface often compared to Tamagawa's — calm and technical rather than rough.",
      "Ashiya is one half of Japan's closest pair of venues: Boat Race Wakamatsu is nearby, and some visitors combine both in a single day.",
    ],
    access: [
      'JR Kagoshima Main Line "Orio" or "Onga-gawa" stations → free taxi or free bus',
    ],
    facts: {
      water: "Freshwater, firm — runs roughly east-west",
      character: "Calm and technical, similar in feel to Tamagawa",
      nightRace: false,
    },
    tip: "Calm, technical water like this rewards consistent racers — our AI weighs racer and motor form heavily for every Ashiya prediction.",
    nearbyAttractions: [
      {
        name: "Ashiya Beach",
        description:
          "A roughly 1km stretch of coastline on the Hibiki-nada sea, popular for swimming in summer.",
      },
      {
        name: "Aqua Ocean",
        description:
          "A water park with a 120m water slide and a lazy river, a short trip from the venue.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/ashiya.jpg",
      alt: "Boat Race Ashiya racecourse",
      credit: "Photo by Umako, CC BY 4.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:Boat_Race_Ashiya_racecourse_260508.jpg",
    },
  },
  {
    slug: "karatsu",
    code: 23,
    name: "Karatsu",
    kanji: "唐津",
    region: "Saga (Kyushu)",
    regionGroup: "kyushu",
    tagline:
      "One of Japan's widest courses, framed by pine forest and bay views",
    intro: [
      "Boat Race Karatsu sits between Karatsu Bay and the famous Niji no Matsubara pine forest in Saga prefecture, on a freshwater pool course that's among the widest and largest in the country. The course runs roughly north-south, and the balance between land and sea breezes means early races tend to face a headwind while later races often get a tailwind.",
      "Like Tokuyama, Karatsu is a year-round morning-racing venue (aside from special tournaments), so a visit pairs naturally with an afternoon exploring the coast.",
    ],
    access: [
      'JR "Higashi-Karatsu" station → free shuttle bus, about 6 minutes (race days only)',
    ],
    facts: {
      water: "Freshwater pool — one of the widest courses in Japan",
      character:
        "Headwind early, tailwind later in the day; no standout quirks otherwise",
      nightRace: false,
    },
    tip: "The wind here tends to flip through the card in a predictable way — our AI factors race-order timing into every Karatsu prediction.",
    nearbyAttractions: [
      {
        name: "Karatsu Castle",
        description:
          "A rebuilt 1608 castle with sweeping views of Karatsu Bay and the pine forest below.",
      },
      {
        name: "Niji no Matsubara",
        description:
          "One of Japan's three great pine groves, a 4.5km stretch with over a million pine trees.",
      },
    ],
    schedule: {
      typicalRaceDays:
        "A year-round morning-racing venue outside special tournaments. Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: null,
  },
  {
    slug: "omura",
    code: 24,
    name: "Omura",
    kanji: "大村",
    region: "Nagasaki (Kyushu)",
    regionGroup: "kyushu",
    tagline:
      "The birthplace of Kyotei itself, and one of the most inside-favored venues",
    intro: [
      "Boat Race Omura holds a unique place in the sport's history: it hosted Japan's first-ever motorboat race, on April 6, 1952, making it the literal birthplace of Kyotei. Wind screens have since been expanded to support night racing, and lane 1 wins here roughly 63% of the time — among the highest rates in the country.",
      "The venue is close to Nagasaki Airport and racing runs about 180 days a year, with a food court (including Sasebo burgers) and play areas that make it an easy family stop.",
    ],
    access: [
      '"Omura" station → about 2.4km, 29 minutes on foot — free shuttle bus recommended',
      "Free buses and ferry connections from Nagasaki, Sasebo, Isahaya and Togitsu",
    ],
    facts: {
      water: "Seawater, wind-screened for night racing",
      character:
        "One of the most inside-favored venues in Japan (lane 1 wins ~63%)",
      nightRace: true,
    },
    tip: "With lane 1 winning this often, our AI weighs start-course strength especially heavily in every Omura prediction.",
    nearbyAttractions: [
      {
        name: "Kotohira Sky Park",
        description:
          "A hilltop park (330m elevation) with sweeping views of Omura Bay and a roller slide.",
      },
      {
        name: "Omura Park",
        description:
          'One of Japan\'s "100 Famous Cherry Blossom Spots," with about 2,000 cherry trees.',
      },
    ],
    schedule: {
      typicalRaceDays:
        "Races about 180 days a year, more than most venues. Regular meets run several times a year, each lasting about 4-7 days.",
      seasonalNotes:
        "Occasionally hosts national-grade (G1/G2) tournaments — check the official schedule for exact dates.",
    },
    image: {
      src: "/images/venues/omura.jpg",
      alt: "Boat Race Omura stadium",
      credit: "Photo by kajikawa, CC BY 3.0, via Wikimedia Commons",
      creditUrl:
        "https://commons.wikimedia.org/wiki/File:%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9%E5%A4%A7%E6%9D%91_-_panoramio.jpg",
    },
  },
];
