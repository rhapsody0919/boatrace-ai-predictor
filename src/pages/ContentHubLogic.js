// 会場データ
export const venues = [
  { code: 1, name: "桐生", id: "kiryu" },
  { code: 2, name: "戸田", id: "toda" },
  { code: 3, name: "江戸川", id: "edogawa" },
  { code: 4, name: "平和島", id: "heiwajima" },
  { code: 5, name: "多摩川", id: "tamagawa" },
  { code: 6, name: "浜名湖", id: "hamanako" },
  { code: 7, name: "蒲郡", id: "gamagori" },
  { code: 8, name: "常滑", id: "tokoname" },
  { code: 9, name: "津", id: "tsu" },
  { code: 10, name: "三国", id: "mikuni" },
  { code: 11, name: "びわこ", id: "biwako" },
  { code: 12, name: "住之江", id: "suminoe" },
  { code: 13, name: "尼崎", id: "amagasaki" },
  { code: 14, name: "鳴門", id: "naruto" },
  { code: 15, name: "丸亀", id: "marugame" },
  { code: 16, name: "児島", id: "kojima" },
  { code: 17, name: "宮島", id: "miyajima" },
  { code: 18, name: "徳山", id: "tokuyama" },
  { code: 19, name: "下関", id: "shimonoseki" },
  { code: 20, name: "若松", id: "wakamatsu" },
  { code: 21, name: "芦屋", id: "ashiya" },
  { code: 22, name: "福岡", id: "fukuoka" },
  { code: 23, name: "唐津", id: "karatsu" },
  { code: 24, name: "大村", id: "omura" },
];

export const formatVenueCode = (code) => String(code).padStart(2, "0");

export const buildCollectionJsonLd = () =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "ボートレースのルール・買い方 完全ガイド【24会場攻略】",
    description:
      "ボートレースのルール・買い方から24会場の攻略法、データ分析手法、予想のコツまで体系的に解説する完全ガイド",
    url: "https://www.boat-ai.jp/guide",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "初心者向けガイド",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "予想戦略",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "会場別攻略ガイド",
        },
        {
          "@type": "ListItem",
          position: 4,
          name: "データ分析手法",
        },
      ],
    },
  });
