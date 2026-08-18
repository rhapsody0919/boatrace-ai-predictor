import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import { trackLanguage } from "./utils/analytics";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
} from "./config/languages";

// 翻訳リソースを SUPPORTED_LANGUAGES から動的に構築
// （言語追加 = config/languages.js への追記 + locales/{lng}/common.json の作成のみ）
const localeModules = import.meta.glob("./locales/*/common.json", {
  eager: true,
});
const resources = {};
for (const { code } of SUPPORTED_LANGUAGES) {
  const mod = localeModules[`./locales/${code}/common.json`];
  if (!mod) {
    // 設定ミスは開発中に即検知させる。本番では白画面を避け ja フォールバックに任せる
    const message = `翻訳ファイルがありません: src/locales/${code}/common.json`;
    if (import.meta.env.DEV) {
      throw new Error(message);
    }
    console.error(message);
    continue;
  }
  resources[code] = { common: mod.default };
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // 未翻訳キー・未対応言語はデフォルト言語（日本語）にフォールバック。
    // 中国語系ロケール（zh-HK / zh-MO / zh 等）は繁体字 zh-TW に寄せる
    // （香港・マカオはターゲット層。簡体字ユーザーにも日本語より繁体字の方が読める）
    fallbackLng: {
      zh: ["zh-TW", DEFAULT_LANGUAGE],
      default: [DEFAULT_LANGUAGE],
    },
    defaultNS: "common",
    ns: ["common"],
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    detection: {
      // localStorageの明示的な選択のみを見る。navigatorでのブラウザ言語自動判定は
      // 使わない（トップページ「/」は言語プレフィックス無しの日本語カノニカルURLだが、
      // navigator検出があると初回訪問時（localStorage未設定）にブラウザ言語で
      // レンダリング内容が変わってしまい、Googlebotが英語ブラウザ相当でクロールした
      // 場合に「/」の索引結果が英語タイトルになる実害が発生した。
      // localStorage未設定時はfallbackLng（ja）に委ねることで、
      // 「/」は常に日本語を返す決定的な挙動にする。
      // 非日本語ユーザーへの言語提案はLanguageSwitcher（明示操作）に一本化する
      order: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: {
      // ReactはXSS対策済みのためエスケープ不要
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

// スクリーンリーダーの読み上げ言語・SEOのため <html lang> を言語切替に同期
// GA4 の言語別分析のためユーザープロパティも送信
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  trackLanguage(lng);
});
// 初期化時点の言語も反映（languageChanged は初期化前のリスナー登録時のみ発火するため）
document.documentElement.lang = i18n.resolvedLanguage || DEFAULT_LANGUAGE;
trackLanguage(i18n.resolvedLanguage || DEFAULT_LANGUAGE);

export default i18n;
