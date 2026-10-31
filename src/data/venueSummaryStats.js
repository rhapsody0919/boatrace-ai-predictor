/**
 * 会場ページ（/venue/N）の常設の要約と「この会場の特徴」カードの数字（BOA-1189 GS02-b）。
 * 生成物。手で直さない。scripts/analysis/venue-summary-stats/build-venue-summary.mjs が
 * data/analysis/venue-summary-stats/venue-techniques.json（sha256 72b4a8a9811a872244b6f163b6831059d9566cab48f326a1fb3f63eb3d908b00）から作る。
 * 定義・言える範囲: docs/reference/venue-summary-stats.md。検証: scripts/maintenance/verify-venue-summary.js
 *
 * - courses: 進入コース別の1着率（枠番ではない）。rate は wins ÷ courseRaces の %（小数1桁、1回だけ丸める）
 * - techniques: 全レースのうちの決まり手の割合。rate は count ÷ races の %
 * - vsNational: その会場を除く全国との差が Bonferroni（24会場、|z|>3.08）を超えたときだけ "higher" / "lower"、それ以外は null
 */
export const VENUE_SUMMARY_STATS = {
  "from": "2025-10-31",
  "to": "2026-10-30",
  "sourceSha256": "72b4a8a9811a872244b6f163b6831059d9566cab48f326a1fb3f63eb3d908b00",
  "national": {
    "races": 55604,
    "courseRaces": 55604,
    "courses": [
      {
        "course": 1,
        "wins": 30840,
        "rate": 55.5
      },
      {
        "course": 2,
        "wins": 7413,
        "rate": 13.3
      },
      {
        "course": 3,
        "wins": 7158,
        "rate": 12.9
      },
      {
        "course": 4,
        "wins": 5728,
        "rate": 10.3
      },
      {
        "course": 5,
        "wins": 3419,
        "rate": 6.1
      },
      {
        "course": 6,
        "wins": 1046,
        "rate": 1.9
      }
    ],
    "techniques": {
      "nige": {
        "count": 29482,
        "rate": 53
      },
      "sashi": {
        "count": 6747,
        "rate": 12.1
      },
      "makuri": {
        "count": 8761,
        "rate": 15.8
      },
      "makurizashi": {
        "count": 6671,
        "rate": 12
      },
      "nuki": {
        "count": 3491,
        "rate": 6.3
      },
      "megumare": {
        "count": 451,
        "rate": 0.8
      }
    }
  },
  "venues": {
    "1": {
      "races": 2421,
      "courseRaces": 2421,
      "courses": [
        {
          "course": 1,
          "wins": 1226,
          "rate": 50.6
        },
        {
          "course": 2,
          "wins": 290,
          "rate": 12
        },
        {
          "course": 3,
          "wins": 325,
          "rate": 13.4
        },
        {
          "course": 4,
          "wins": 294,
          "rate": 12.1
        },
        {
          "course": 5,
          "wins": 225,
          "rate": 9.3
        },
        {
          "course": 6,
          "wins": 61,
          "rate": 2.5
        }
      ],
      "techniques": {
        "nige": {
          "count": 1178,
          "rate": 48.7
        },
        "sashi": {
          "count": 264,
          "rate": 10.9
        },
        "makuri": {
          "count": 470,
          "rate": 19.4
        },
        "makurizashi": {
          "count": 360,
          "rate": 14.9
        },
        "nuki": {
          "count": 132,
          "rate": 5.5
        },
        "megumare": {
          "count": 17,
          "rate": 0.7
        }
      },
      "vsNational": {
        "course1": "lower",
        "makuri": "higher",
        "makurizashi": "higher"
      }
    },
    "2": {
      "races": 2208,
      "courseRaces": 2208,
      "courses": [
        {
          "course": 1,
          "wins": 938,
          "rate": 42.5
        },
        {
          "course": 2,
          "wins": 383,
          "rate": 17.3
        },
        {
          "course": 3,
          "wins": 365,
          "rate": 16.5
        },
        {
          "course": 4,
          "wins": 301,
          "rate": 13.6
        },
        {
          "course": 5,
          "wins": 172,
          "rate": 7.8
        },
        {
          "course": 6,
          "wins": 49,
          "rate": 2.2
        }
      ],
      "techniques": {
        "nige": {
          "count": 898,
          "rate": 40.7
        },
        "sashi": {
          "count": 292,
          "rate": 13.2
        },
        "makuri": {
          "count": 586,
          "rate": 26.5
        },
        "makurizashi": {
          "count": 264,
          "rate": 12
        },
        "nuki": {
          "count": 148,
          "rate": 6.7
        },
        "megumare": {
          "count": 20,
          "rate": 0.9
        }
      },
      "vsNational": {
        "course1": "lower",
        "makuri": "higher",
        "makurizashi": null
      }
    },
    "3": {
      "races": 2061,
      "courseRaces": 2061,
      "courses": [
        {
          "course": 1,
          "wins": 964,
          "rate": 46.8
        },
        {
          "course": 2,
          "wins": 352,
          "rate": 17.1
        },
        {
          "course": 3,
          "wins": 301,
          "rate": 14.6
        },
        {
          "course": 4,
          "wins": 247,
          "rate": 12
        },
        {
          "course": 5,
          "wins": 137,
          "rate": 6.6
        },
        {
          "course": 6,
          "wins": 60,
          "rate": 2.9
        }
      ],
      "techniques": {
        "nige": {
          "count": 901,
          "rate": 43.7
        },
        "sashi": {
          "count": 279,
          "rate": 13.5
        },
        "makuri": {
          "count": 452,
          "rate": 21.9
        },
        "makurizashi": {
          "count": 209,
          "rate": 10.1
        },
        "nuki": {
          "count": 197,
          "rate": 9.6
        },
        "megumare": {
          "count": 23,
          "rate": 1.1
        }
      },
      "vsNational": {
        "course1": "lower",
        "makuri": "higher",
        "makurizashi": null
      }
    },
    "4": {
      "races": 2031,
      "courseRaces": 2031,
      "courses": [
        {
          "course": 1,
          "wins": 900,
          "rate": 44.3
        },
        {
          "course": 2,
          "wins": 329,
          "rate": 16.2
        },
        {
          "course": 3,
          "wins": 342,
          "rate": 16.8
        },
        {
          "course": 4,
          "wins": 249,
          "rate": 12.3
        },
        {
          "course": 5,
          "wins": 160,
          "rate": 7.9
        },
        {
          "course": 6,
          "wins": 51,
          "rate": 2.5
        }
      ],
      "techniques": {
        "nige": {
          "count": 860,
          "rate": 42.3
        },
        "sashi": {
          "count": 362,
          "rate": 17.8
        },
        "makuri": {
          "count": 404,
          "rate": 19.9
        },
        "makurizashi": {
          "count": 250,
          "rate": 12.3
        },
        "nuki": {
          "count": 132,
          "rate": 6.5
        },
        "megumare": {
          "count": 23,
          "rate": 1.1
        }
      },
      "vsNational": {
        "course1": "lower",
        "makuri": "higher",
        "makurizashi": null
      }
    },
    "5": {
      "races": 2311,
      "courseRaces": 2311,
      "courses": [
        {
          "course": 1,
          "wins": 1255,
          "rate": 54.3
        },
        {
          "course": 2,
          "wins": 309,
          "rate": 13.4
        },
        {
          "course": 3,
          "wins": 292,
          "rate": 12.6
        },
        {
          "course": 4,
          "wins": 255,
          "rate": 11
        },
        {
          "course": 5,
          "wins": 142,
          "rate": 6.1
        },
        {
          "course": 6,
          "wins": 58,
          "rate": 2.5
        }
      ],
      "techniques": {
        "nige": {
          "count": 1199,
          "rate": 51.9
        },
        "sashi": {
          "count": 269,
          "rate": 11.6
        },
        "makuri": {
          "count": 414,
          "rate": 17.9
        },
        "makurizashi": {
          "count": 272,
          "rate": 11.8
        },
        "nuki": {
          "count": 142,
          "rate": 6.1
        },
        "megumare": {
          "count": 15,
          "rate": 0.6
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": null
      }
    },
    "6": {
      "races": 2432,
      "courseRaces": 2432,
      "courses": [
        {
          "course": 1,
          "wins": 1332,
          "rate": 54.8
        },
        {
          "course": 2,
          "wins": 312,
          "rate": 12.8
        },
        {
          "course": 3,
          "wins": 328,
          "rate": 13.5
        },
        {
          "course": 4,
          "wins": 246,
          "rate": 10.1
        },
        {
          "course": 5,
          "wins": 164,
          "rate": 6.7
        },
        {
          "course": 6,
          "wins": 50,
          "rate": 2.1
        }
      ],
      "techniques": {
        "nige": {
          "count": 1264,
          "rate": 52
        },
        "sashi": {
          "count": 279,
          "rate": 11.5
        },
        "makuri": {
          "count": 352,
          "rate": 14.5
        },
        "makurizashi": {
          "count": 346,
          "rate": 14.2
        },
        "nuki": {
          "count": 163,
          "rate": 6.7
        },
        "megumare": {
          "count": 28,
          "rate": 1.2
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": "higher"
      }
    },
    "7": {
      "races": 2454,
      "courseRaces": 2454,
      "courses": [
        {
          "course": 1,
          "wins": 1407,
          "rate": 57.3
        },
        {
          "course": 2,
          "wins": 287,
          "rate": 11.7
        },
        {
          "course": 3,
          "wins": 281,
          "rate": 11.5
        },
        {
          "course": 4,
          "wins": 269,
          "rate": 11
        },
        {
          "course": 5,
          "wins": 156,
          "rate": 6.4
        },
        {
          "course": 6,
          "wins": 54,
          "rate": 2.2
        }
      ],
      "techniques": {
        "nige": {
          "count": 1369,
          "rate": 55.8
        },
        "sashi": {
          "count": 213,
          "rate": 8.7
        },
        "makuri": {
          "count": 406,
          "rate": 16.5
        },
        "makurizashi": {
          "count": 330,
          "rate": 13.4
        },
        "nuki": {
          "count": 119,
          "rate": 4.8
        },
        "megumare": {
          "count": 17,
          "rate": 0.7
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": null
      }
    },
    "8": {
      "races": 2558,
      "courseRaces": 2558,
      "courses": [
        {
          "course": 1,
          "wins": 1490,
          "rate": 58.2
        },
        {
          "course": 2,
          "wins": 338,
          "rate": 13.2
        },
        {
          "course": 3,
          "wins": 266,
          "rate": 10.4
        },
        {
          "course": 4,
          "wins": 263,
          "rate": 10.3
        },
        {
          "course": 5,
          "wins": 148,
          "rate": 5.8
        },
        {
          "course": 6,
          "wins": 53,
          "rate": 2.1
        }
      ],
      "techniques": {
        "nige": {
          "count": 1428,
          "rate": 55.8
        },
        "sashi": {
          "count": 279,
          "rate": 10.9
        },
        "makuri": {
          "count": 409,
          "rate": 16
        },
        "makurizashi": {
          "count": 277,
          "rate": 10.8
        },
        "nuki": {
          "count": 141,
          "rate": 5.5
        },
        "megumare": {
          "count": 24,
          "rate": 0.9
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": null
      }
    },
    "9": {
      "races": 2302,
      "courseRaces": 2302,
      "courses": [
        {
          "course": 1,
          "wins": 1328,
          "rate": 57.7
        },
        {
          "course": 2,
          "wins": 318,
          "rate": 13.8
        },
        {
          "course": 3,
          "wins": 263,
          "rate": 11.4
        },
        {
          "course": 4,
          "wins": 216,
          "rate": 9.4
        },
        {
          "course": 5,
          "wins": 140,
          "rate": 6.1
        },
        {
          "course": 6,
          "wins": 37,
          "rate": 1.6
        }
      ],
      "techniques": {
        "nige": {
          "count": 1273,
          "rate": 55.3
        },
        "sashi": {
          "count": 300,
          "rate": 13
        },
        "makuri": {
          "count": 277,
          "rate": 12
        },
        "makurizashi": {
          "count": 291,
          "rate": 12.6
        },
        "nuki": {
          "count": 138,
          "rate": 6
        },
        "megumare": {
          "count": 23,
          "rate": 1
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": "lower",
        "makurizashi": null
      }
    },
    "10": {
      "races": 2284,
      "courseRaces": 2284,
      "courses": [
        {
          "course": 1,
          "wins": 1189,
          "rate": 52.1
        },
        {
          "course": 2,
          "wins": 339,
          "rate": 14.8
        },
        {
          "course": 3,
          "wins": 337,
          "rate": 14.8
        },
        {
          "course": 4,
          "wins": 241,
          "rate": 10.6
        },
        {
          "course": 5,
          "wins": 137,
          "rate": 6
        },
        {
          "course": 6,
          "wins": 41,
          "rate": 1.8
        }
      ],
      "techniques": {
        "nige": {
          "count": 1124,
          "rate": 49.2
        },
        "sashi": {
          "count": 362,
          "rate": 15.8
        },
        "makuri": {
          "count": 344,
          "rate": 15.1
        },
        "makurizashi": {
          "count": 284,
          "rate": 12.4
        },
        "nuki": {
          "count": 152,
          "rate": 6.7
        },
        "megumare": {
          "count": 18,
          "rate": 0.8
        }
      },
      "vsNational": {
        "course1": "lower",
        "makuri": null,
        "makurizashi": null
      }
    },
    "11": {
      "races": 2193,
      "courseRaces": 2193,
      "courses": [
        {
          "course": 1,
          "wins": 1187,
          "rate": 54.1
        },
        {
          "course": 2,
          "wins": 299,
          "rate": 13.6
        },
        {
          "course": 3,
          "wins": 307,
          "rate": 14
        },
        {
          "course": 4,
          "wins": 218,
          "rate": 9.9
        },
        {
          "course": 5,
          "wins": 143,
          "rate": 6.5
        },
        {
          "course": 6,
          "wins": 39,
          "rate": 1.8
        }
      ],
      "techniques": {
        "nige": {
          "count": 1140,
          "rate": 52
        },
        "sashi": {
          "count": 279,
          "rate": 12.7
        },
        "makuri": {
          "count": 325,
          "rate": 14.8
        },
        "makurizashi": {
          "count": 307,
          "rate": 14
        },
        "nuki": {
          "count": 124,
          "rate": 5.7
        },
        "megumare": {
          "count": 18,
          "rate": 0.8
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": null
      }
    },
    "12": {
      "races": 2267,
      "courseRaces": 2267,
      "courses": [
        {
          "course": 1,
          "wins": 1305,
          "rate": 57.6
        },
        {
          "course": 2,
          "wins": 314,
          "rate": 13.9
        },
        {
          "course": 3,
          "wins": 258,
          "rate": 11.4
        },
        {
          "course": 4,
          "wins": 233,
          "rate": 10.3
        },
        {
          "course": 5,
          "wins": 119,
          "rate": 5.2
        },
        {
          "course": 6,
          "wins": 38,
          "rate": 1.7
        }
      ],
      "techniques": {
        "nige": {
          "count": 1264,
          "rate": 55.8
        },
        "sashi": {
          "count": 292,
          "rate": 12.9
        },
        "makuri": {
          "count": 337,
          "rate": 14.9
        },
        "makurizashi": {
          "count": 240,
          "rate": 10.6
        },
        "nuki": {
          "count": 119,
          "rate": 5.2
        },
        "megumare": {
          "count": 15,
          "rate": 0.7
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": null
      }
    },
    "13": {
      "races": 2510,
      "courseRaces": 2510,
      "courses": [
        {
          "course": 1,
          "wins": 1508,
          "rate": 60.1
        },
        {
          "course": 2,
          "wins": 308,
          "rate": 12.3
        },
        {
          "course": 3,
          "wins": 288,
          "rate": 11.5
        },
        {
          "course": 4,
          "wins": 246,
          "rate": 9.8
        },
        {
          "course": 5,
          "wins": 126,
          "rate": 5
        },
        {
          "course": 6,
          "wins": 34,
          "rate": 1.4
        }
      ],
      "techniques": {
        "nige": {
          "count": 1463,
          "rate": 58.3
        },
        "sashi": {
          "count": 289,
          "rate": 11.5
        },
        "makuri": {
          "count": 317,
          "rate": 12.6
        },
        "makurizashi": {
          "count": 293,
          "rate": 11.7
        },
        "nuki": {
          "count": 131,
          "rate": 5.2
        },
        "megumare": {
          "count": 17,
          "rate": 0.7
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": "lower",
        "makurizashi": null
      }
    },
    "14": {
      "races": 2137,
      "courseRaces": 2137,
      "courses": [
        {
          "course": 1,
          "wins": 1043,
          "rate": 48.8
        },
        {
          "course": 2,
          "wins": 310,
          "rate": 14.5
        },
        {
          "course": 3,
          "wins": 332,
          "rate": 15.5
        },
        {
          "course": 4,
          "wins": 245,
          "rate": 11.5
        },
        {
          "course": 5,
          "wins": 165,
          "rate": 7.7
        },
        {
          "course": 6,
          "wins": 42,
          "rate": 2
        }
      ],
      "techniques": {
        "nige": {
          "count": 995,
          "rate": 46.6
        },
        "sashi": {
          "count": 279,
          "rate": 13.1
        },
        "makuri": {
          "count": 418,
          "rate": 19.6
        },
        "makurizashi": {
          "count": 294,
          "rate": 13.8
        },
        "nuki": {
          "count": 134,
          "rate": 6.3
        },
        "megumare": {
          "count": 17,
          "rate": 0.8
        }
      },
      "vsNational": {
        "course1": "lower",
        "makuri": "higher",
        "makurizashi": null
      }
    },
    "15": {
      "races": 2308,
      "courseRaces": 2308,
      "courses": [
        {
          "course": 1,
          "wins": 1270,
          "rate": 55
        },
        {
          "course": 2,
          "wins": 304,
          "rate": 13.2
        },
        {
          "course": 3,
          "wins": 293,
          "rate": 12.7
        },
        {
          "course": 4,
          "wins": 230,
          "rate": 10
        },
        {
          "course": 5,
          "wins": 160,
          "rate": 6.9
        },
        {
          "course": 6,
          "wins": 51,
          "rate": 2.2
        }
      ],
      "techniques": {
        "nige": {
          "count": 1222,
          "rate": 52.9
        },
        "sashi": {
          "count": 303,
          "rate": 13.1
        },
        "makuri": {
          "count": 300,
          "rate": 13
        },
        "makurizashi": {
          "count": 331,
          "rate": 14.3
        },
        "nuki": {
          "count": 134,
          "rate": 5.8
        },
        "megumare": {
          "count": 18,
          "rate": 0.8
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": "lower",
        "makurizashi": "higher"
      }
    },
    "16": {
      "races": 2400,
      "courseRaces": 2400,
      "courses": [
        {
          "course": 1,
          "wins": 1295,
          "rate": 54
        },
        {
          "course": 2,
          "wins": 301,
          "rate": 12.5
        },
        {
          "course": 3,
          "wins": 336,
          "rate": 14
        },
        {
          "course": 4,
          "wins": 259,
          "rate": 10.8
        },
        {
          "course": 5,
          "wins": 156,
          "rate": 6.5
        },
        {
          "course": 6,
          "wins": 53,
          "rate": 2.2
        }
      ],
      "techniques": {
        "nige": {
          "count": 1234,
          "rate": 51.4
        },
        "sashi": {
          "count": 301,
          "rate": 12.5
        },
        "makuri": {
          "count": 334,
          "rate": 13.9
        },
        "makurizashi": {
          "count": 369,
          "rate": 15.4
        },
        "nuki": {
          "count": 144,
          "rate": 6
        },
        "megumare": {
          "count": 18,
          "rate": 0.8
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": "higher"
      }
    },
    "17": {
      "races": 2345,
      "courseRaces": 2345,
      "courses": [
        {
          "course": 1,
          "wins": 1343,
          "rate": 57.3
        },
        {
          "course": 2,
          "wins": 280,
          "rate": 11.9
        },
        {
          "course": 3,
          "wins": 320,
          "rate": 13.6
        },
        {
          "course": 4,
          "wins": 236,
          "rate": 10.1
        },
        {
          "course": 5,
          "wins": 131,
          "rate": 5.6
        },
        {
          "course": 6,
          "wins": 35,
          "rate": 1.5
        }
      ],
      "techniques": {
        "nige": {
          "count": 1286,
          "rate": 54.8
        },
        "sashi": {
          "count": 236,
          "rate": 10.1
        },
        "makuri": {
          "count": 385,
          "rate": 16.4
        },
        "makurizashi": {
          "count": 289,
          "rate": 12.3
        },
        "nuki": {
          "count": 133,
          "rate": 5.7
        },
        "megumare": {
          "count": 15,
          "rate": 0.6
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": null,
        "makurizashi": null
      }
    },
    "18": {
      "races": 2592,
      "courseRaces": 2592,
      "courses": [
        {
          "course": 1,
          "wins": 1597,
          "rate": 61.6
        },
        {
          "course": 2,
          "wins": 325,
          "rate": 12.5
        },
        {
          "course": 3,
          "wins": 297,
          "rate": 11.5
        },
        {
          "course": 4,
          "wins": 225,
          "rate": 8.7
        },
        {
          "course": 5,
          "wins": 118,
          "rate": 4.6
        },
        {
          "course": 6,
          "wins": 30,
          "rate": 1.2
        }
      ],
      "techniques": {
        "nige": {
          "count": 1525,
          "rate": 58.8
        },
        "sashi": {
          "count": 326,
          "rate": 12.6
        },
        "makuri": {
          "count": 324,
          "rate": 12.5
        },
        "makurizashi": {
          "count": 233,
          "rate": 9
        },
        "nuki": {
          "count": 172,
          "rate": 6.6
        },
        "megumare": {
          "count": 12,
          "rate": 0.5
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": "lower",
        "makurizashi": "lower"
      }
    },
    "19": {
      "races": 2276,
      "courseRaces": 2276,
      "courses": [
        {
          "course": 1,
          "wins": 1402,
          "rate": 61.6
        },
        {
          "course": 2,
          "wins": 242,
          "rate": 10.6
        },
        {
          "course": 3,
          "wins": 275,
          "rate": 12.1
        },
        {
          "course": 4,
          "wins": 206,
          "rate": 9.1
        },
        {
          "course": 5,
          "wins": 111,
          "rate": 4.9
        },
        {
          "course": 6,
          "wins": 40,
          "rate": 1.8
        }
      ],
      "techniques": {
        "nige": {
          "count": 1332,
          "rate": 58.5
        },
        "sashi": {
          "count": 219,
          "rate": 9.6
        },
        "makuri": {
          "count": 274,
          "rate": 12
        },
        "makurizashi": {
          "count": 285,
          "rate": 12.5
        },
        "nuki": {
          "count": 148,
          "rate": 6.5
        },
        "megumare": {
          "count": 18,
          "rate": 0.8
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": "lower",
        "makurizashi": null
      }
    },
    "20": {
      "races": 2376,
      "courseRaces": 2376,
      "courses": [
        {
          "course": 1,
          "wins": 1407,
          "rate": 59.2
        },
        {
          "course": 2,
          "wins": 318,
          "rate": 13.4
        },
        {
          "course": 3,
          "wins": 264,
          "rate": 11.1
        },
        {
          "course": 4,
          "wins": 233,
          "rate": 9.8
        },
        {
          "course": 5,
          "wins": 113,
          "rate": 4.8
        },
        {
          "course": 6,
          "wins": 41,
          "rate": 1.7
        }
      ],
      "techniques": {
        "nige": {
          "count": 1348,
          "rate": 56.7
        },
        "sashi": {
          "count": 304,
          "rate": 12.8
        },
        "makuri": {
          "count": 318,
          "rate": 13.4
        },
        "makurizashi": {
          "count": 229,
          "rate": 9.6
        },
        "nuki": {
          "count": 161,
          "rate": 6.8
        },
        "megumare": {
          "count": 16,
          "rate": 0.7
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": "lower",
        "makurizashi": "lower"
      }
    },
    "21": {
      "races": 2292,
      "courseRaces": 2292,
      "courses": [
        {
          "course": 1,
          "wins": 1399,
          "rate": 61
        },
        {
          "course": 2,
          "wins": 221,
          "rate": 9.6
        },
        {
          "course": 3,
          "wins": 247,
          "rate": 10.8
        },
        {
          "course": 4,
          "wins": 229,
          "rate": 10
        },
        {
          "course": 5,
          "wins": 155,
          "rate": 6.8
        },
        {
          "course": 6,
          "wins": 41,
          "rate": 1.8
        }
      ],
      "techniques": {
        "nige": {
          "count": 1329,
          "rate": 58
        },
        "sashi": {
          "count": 186,
          "rate": 8.1
        },
        "makuri": {
          "count": 350,
          "rate": 15.3
        },
        "makurizashi": {
          "count": 252,
          "rate": 11
        },
        "nuki": {
          "count": 150,
          "rate": 6.5
        },
        "megumare": {
          "count": 25,
          "rate": 1.1
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": null,
        "makurizashi": null
      }
    },
    "22": {
      "races": 2339,
      "courseRaces": 2339,
      "courses": [
        {
          "course": 1,
          "wins": 1387,
          "rate": 59.3
        },
        {
          "course": 2,
          "wins": 352,
          "rate": 15
        },
        {
          "course": 3,
          "wins": 327,
          "rate": 14
        },
        {
          "course": 4,
          "wins": 172,
          "rate": 7.4
        },
        {
          "course": 5,
          "wins": 82,
          "rate": 3.5
        },
        {
          "course": 6,
          "wins": 19,
          "rate": 0.8
        }
      ],
      "techniques": {
        "nige": {
          "count": 1306,
          "rate": 55.8
        },
        "sashi": {
          "count": 275,
          "rate": 11.8
        },
        "makuri": {
          "count": 411,
          "rate": 17.6
        },
        "makurizashi": {
          "count": 143,
          "rate": 6.1
        },
        "nuki": {
          "count": 189,
          "rate": 8.1
        },
        "megumare": {
          "count": 15,
          "rate": 0.6
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": null,
        "makurizashi": "lower"
      }
    },
    "23": {
      "races": 2166,
      "courseRaces": 2166,
      "courses": [
        {
          "course": 1,
          "wins": 1240,
          "rate": 57.2
        },
        {
          "course": 2,
          "wins": 291,
          "rate": 13.4
        },
        {
          "course": 3,
          "wins": 265,
          "rate": 12.2
        },
        {
          "course": 4,
          "wins": 204,
          "rate": 9.4
        },
        {
          "course": 5,
          "wins": 130,
          "rate": 6
        },
        {
          "course": 6,
          "wins": 36,
          "rate": 1.7
        }
      ],
      "techniques": {
        "nige": {
          "count": 1182,
          "rate": 54.6
        },
        "sashi": {
          "count": 290,
          "rate": 13.4
        },
        "makuri": {
          "count": 283,
          "rate": 13.1
        },
        "makurizashi": {
          "count": 240,
          "rate": 11.1
        },
        "nuki": {
          "count": 155,
          "rate": 7.2
        },
        "megumare": {
          "count": 16,
          "rate": 0.7
        }
      },
      "vsNational": {
        "course1": null,
        "makuri": "lower",
        "makurizashi": null
      }
    },
    "24": {
      "races": 2341,
      "courseRaces": 2341,
      "courses": [
        {
          "course": 1,
          "wins": 1428,
          "rate": 61
        },
        {
          "course": 2,
          "wins": 291,
          "rate": 12.4
        },
        {
          "course": 3,
          "wins": 249,
          "rate": 10.6
        },
        {
          "course": 4,
          "wins": 211,
          "rate": 9
        },
        {
          "course": 5,
          "wins": 129,
          "rate": 5.5
        },
        {
          "course": 6,
          "wins": 33,
          "rate": 1.4
        }
      ],
      "techniques": {
        "nige": {
          "count": 1362,
          "rate": 58.2
        },
        "sashi": {
          "count": 269,
          "rate": 11.5
        },
        "makuri": {
          "count": 271,
          "rate": 11.6
        },
        "makurizashi": {
          "count": 283,
          "rate": 12.1
        },
        "nuki": {
          "count": 133,
          "rate": 5.7
        },
        "megumare": {
          "count": 23,
          "rate": 1
        }
      },
      "vsNational": {
        "course1": "higher",
        "makuri": "lower",
        "makurizashi": null
      }
    }
  }
};
