import { blogPostsEn } from "../data/blogPostsEn.js";

/**
 * 対応言語の唯一の情報源
 * React 非依存の純粋な JS モジュール（sitemap 生成等の Node スクリプトからも import する）
 * 言語追加の手順は docs/operation/add-language.md を参照
 */
export const SUPPORTED_LANGUAGES = [
  {
    code: "ja",
    label: "日本語",
    shortLabel: "JA",
    ogLocale: "ja_JP",
    hreflang: "ja",
  },
  {
    code: "en",
    label: "English",
    shortLabel: "EN",
    ogLocale: "en_US",
    hreflang: "en",
  },
  // 繁体字の hreflang は地域（TW）でなく文字体系（Hant）で指定する
  {
    code: "zh-TW",
    label: "繁體中文",
    shortLabel: "中文",
    ogLocale: "zh_TW",
    hreflang: "zh-Hant",
  },
  {
    code: "ko",
    label: "한국어",
    shortLabel: "한국어",
    ogLocale: "ko_KR",
    hreflang: "ko",
  },
];

// URL プレフィックスなしで配信するデフォルト言語
export const DEFAULT_LANGUAGE = "ja";

// 言語設定の localStorage キー（LanguageSwitcher / AppRouter からも参照）
export const LANGUAGE_STORAGE_KEY = "boatai-language";

// 特定言語にのみ存在するパスと対応言語（ルーティング・hreflang で共用）
// 会場別ビジターガイドのko版は24会場全てのデータが揃ったため有効化済み（en/zh-TWと同じフルセット）
export const LANGUAGE_ONLY_PATHS = {
  "/venues": ["en", "zh-TW", "ko"],
  "/venues/region": ["en", "zh-TW", "ko"],
};

// 配下の一部パスだけが翻訳済みのケース（LANGUAGE_ONLY_PATHS/TRANSLATED_PATHSは
// 「配下丸ごと翻訳済み」前提のため表現できない）。ブログはfeatured記事の一部のみ
// 英語版が存在するため、記事単位のホワイトリストで判定する。
// entries は blogPostsEn.js から動的導出（新規記事追加時にここへの手動追記は不要）。
// 詳細: docs/adr/0005-blog-partial-translation-routing.md
export const PARTIALLY_TRANSLATED_PATHS = {
  "/blog": {
    listPage: true,
    entries: blogPostsEn.map((post) => post.id),
    langs: ["ja", "en"],
  },
};

// basePathがPARTIALLY_TRANSLATED_PATHSのいずれかにマッチすればその設定を返す
// LANGUAGE_ONLY_PATHS同様、入れ子のprefixが登録され得るため最長一致を優先する（BOA-138の教訓）
function matchPartiallyTranslated(basePath) {
  const matches = Object.entries(PARTIALLY_TRANSLATED_PATHS).filter(
    ([prefix]) => basePath === prefix || basePath.startsWith(`${prefix}/`),
  );
  if (matches.length === 0) return null;

  const [prefix, config] = matches.reduce((longest, current) =>
    current[0].length > longest[0].length ? current : longest,
  );

  if (basePath === prefix) {
    return config.listPage ? config : null;
  }
  const rest = basePath.slice(prefix.length + 1);
  return config.entries.includes(rest) ? config : null;
}

/**
 * コンテンツが実際に翻訳されているパス（プレフィックス一致）。
 *
 * ここに無いパスは ja 専用として扱い、/{lng}/... アクセスは ja 版へリダイレクト、
 * hreflang 非出力・言語スイッチャー無効化の対象になる。
 * 「lang=en を宣言しながら日本語コンテンツを配信する」状態は、ブラウザ自動翻訳の
 * 発動を妨げ、検索エンジンにも矛盾シグナルを送るため禁止（2026-08 i18n監査で決定）。
 *
 * 新ページ追加時は必ず「翻訳対象/ja専用/特定言語専用」を決めること
 * （プロジェクトCLAUDE.md「多言語化の3区分」参照）。翻訳対象にする場合は
 * 4言語のi18nキーを同PRで追加した上でここに登録する。
 */
export const TRANSLATED_PATHS = [
  "/",
  "/guide",
  "/venues",
  "/winning-technique",
];

// パス（言語プレフィックス除去済み）のコンテンツが翻訳済みかどうか
export function isPathTranslated(basePath) {
  if (
    TRANSLATED_PATHS.some(
      (p) => basePath === p || (p !== "/" && basePath.startsWith(`${p}/`)),
    )
  ) {
    return true;
  }
  return matchPartiallyTranslated(basePath) !== null;
}

// パス（言語プレフィックス除去済み）が提供されている言語の定義一覧を返す
// /venues と /venues/region のように入れ子のパスが登録され得るため、
// 最初にマッチしたエントリではなく最も長く一致するエントリを優先する（BOA-138で発見・修正）
export function getAvailableLanguages(basePath) {
  // 未翻訳パスは ja のみ提供（hreflang非出力・言語スイッチャー無効化に波及する）
  if (!isPathTranslated(basePath)) {
    return SUPPORTED_LANGUAGES.filter(({ code }) => code === DEFAULT_LANGUAGE);
  }

  const partial = matchPartiallyTranslated(basePath);
  if (partial) {
    return SUPPORTED_LANGUAGES.filter(({ code }) =>
      partial.langs.includes(code),
    );
  }

  const matches = Object.entries(LANGUAGE_ONLY_PATHS).filter(
    ([p]) => basePath === p || basePath.startsWith(`${p}/`),
  );
  if (matches.length === 0) return SUPPORTED_LANGUAGES;
  const [, codes] = matches.reduce((longest, current) =>
    current[0].length > longest[0].length ? current : longest,
  );
  return SUPPORTED_LANGUAGES.filter(({ code }) => codes.includes(code));
}

const DEFAULT_LANGUAGE_DEF = SUPPORTED_LANGUAGES.find(
  (l) => l.code === DEFAULT_LANGUAGE,
);

// 言語コードから定義を取得（未対応コードはデフォルト言語の定義を返す）
export function getLanguage(code) {
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? DEFAULT_LANGUAGE_DEF
  );
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
