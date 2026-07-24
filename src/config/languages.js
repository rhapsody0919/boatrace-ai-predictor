/**
 * 対応言語の唯一の情報源
 * React 非依存の純粋な JS モジュール（sitemap 生成等の Node スクリプトからも import する）
 * 言語追加の手順は docs/operation/add-language.md を参照
 */
export const SUPPORTED_LANGUAGES = [
  { code: "ja", label: "日本語", shortLabel: "JA", ogLocale: "ja_JP", hreflang: "ja" },
  { code: "en", label: "English", shortLabel: "EN", ogLocale: "en_US", hreflang: "en" },
  // 繁体字の hreflang は地域（TW）でなく文字体系（Hant）で指定する
  { code: "zh-TW", label: "繁體中文", shortLabel: "中文", ogLocale: "zh_TW", hreflang: "zh-Hant" },
  { code: "ko", label: "한국어", shortLabel: "한국어", ogLocale: "ko_KR", hreflang: "ko" },
];

// URL プレフィックスなしで配信するデフォルト言語
export const DEFAULT_LANGUAGE = "ja";

// 言語設定の localStorage キー（LanguageSwitcher / AppRouter からも参照）
export const LANGUAGE_STORAGE_KEY = "boatai-language";

// 特定言語にのみ存在するパスと対応言語（ルーティング・hreflang で共用）
export const LANGUAGE_ONLY_PATHS = {
  "/venues": ["en"],
};

// パス（言語プレフィックス除去済み）が提供されている言語の定義一覧を返す
export function getAvailableLanguages(basePath) {
  const entry = Object.entries(LANGUAGE_ONLY_PATHS).find(
    ([p]) => basePath === p || basePath.startsWith(`${p}/`),
  );
  if (!entry) return SUPPORTED_LANGUAGES;
  return SUPPORTED_LANGUAGES.filter(({ code }) => entry[1].includes(code));
}

const DEFAULT_LANGUAGE_DEF = SUPPORTED_LANGUAGES.find(
  (l) => l.code === DEFAULT_LANGUAGE,
);

// 言語コードから定義を取得（未対応コードはデフォルト言語の定義を返す）
export function getLanguage(code) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? DEFAULT_LANGUAGE_DEF;
}

/**
 * パスから言語コードとプレフィックス除去後の基準パスを得る
 * 例: '/en/guide' → { lng: 'en', basePath: '/guide' }、'/guide' → { lng: 'ja', basePath: '/guide' }
 */
export function parseLangFromPath(pathname) {
  for (const { code } of SUPPORTED_LANGUAGES) {
    if (code === DEFAULT_LANGUAGE) continue;
    if (pathname === `/${code}` || pathname.startsWith(`/${code}/`)) {
      return { lng: code, basePath: pathname.slice(code.length + 1) || "/" };
    }
  }
  return { lng: DEFAULT_LANGUAGE, basePath: pathname || "/" };
}

/**
 * パスを指定言語のプレフィックス付きに変換する（既存プレフィックスは付け替え）
 * 例: localizePath('/guide', 'en') → '/en/guide'、localizePath('/en/guide', 'ja') → '/guide'
 */
export function localizePath(path, lng) {
  const { basePath } = parseLangFromPath(path);
  if (!lng || lng === DEFAULT_LANGUAGE) return basePath;
  return basePath === "/" ? `/${lng}/` : `/${lng}${basePath}`;
}
