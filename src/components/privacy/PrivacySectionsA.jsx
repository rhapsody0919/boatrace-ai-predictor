import { ExtLink, Section } from './PrivacyParts.jsx'
import { pGapStyle, pStyle, ulStyle } from './privacyStyles.js'

export function Section1() {
    return (
        <Section title="1. 基本方針">
            <p style={pStyle}>
                ボートレースAI予測（以下「当サイト」）は、ユーザーの個人情報の重要性を認識し、個人情報の保護に関する法律及び関連法令を遵守し、適切に取り扱います。
            </p>
        </Section>
    )
}

export function Section2() {
    return (
        <Section title="2. 収集する情報">
            <p style={pGapStyle}>
                当サイトでは、以下の情報を収集する場合があります：
            </p>
            <ul style={ulStyle}>
                <li>アクセス情報（IPアドレス、ブラウザ種類、訪問日時、閲覧ページ等）</li>
                <li>Cookie及びこれに類する技術により取得した情報</li>
                <li>お問い合わせフォームにご入力いただいた情報（メールアドレス、お名前等）</li>
                <li>ご意見・ご要望の送信（画面右下の「ご意見」ボタン等）でご入力いただいた内容（自由記述、選んだ種類、満足度）と、どの種類の画面から送ったか、表示言語、送信日時</li>
                <li>龍神ソナー（過去の類似レースを探す機能）の画面に出る質問「龍神ソナーは予想の材料になりましたか？」へのご回答（選んだ答え・理由、自由記述）と、どのレースか、龍神ソナーのどの段階・どのタブを開いていたか、表示言語、送信日時</li>
                <li>上の2つの送信に付ける、ブラウザごとの識別番号</li>
            </ul>
            <p style={pGapStyle}>
                上の2つには、お名前やメールアドレスの入力欄はありません。ご入力いただいた内容は公開しません。
                読むのは運営者（運営者が分析に使うサービスを含む）だけです。内容にお名前や連絡先を書かないでください。
                書かれていることに気づいた場合は、運営者が削除します。
            </p>
            <p style={pStyle}>
                これらの内容は、当サイトが利用する外部のクラウドサービスのデータベースに保存します。保存の期限は定めていません。
            </p>
        </Section>
    )
}

export function Section3() {
    return (
        <Section title="3. 情報の利用目的">
            <p style={pGapStyle}>
                収集した情報は、以下の目的で利用します：
            </p>
            <ul style={ulStyle}>
                <li>サービスの提供、維持、改善のため</li>
                <li>ご意見・ご要望への対応と、新しい機能の検討のため</li>
                <li>同じブラウザからの不正な連続送信を防ぐため</li>
                <li>ユーザーサポート及びお問い合わせへの対応のため</li>
                <li>サイトのアクセス解析及び利用状況の把握のため</li>
                <li>広告配信のため</li>
            </ul>
        </Section>
    )
}

export function Section4() {
    return (
        <Section title="4. 広告配信について">
            <p style={pGapStyle}>
                当サイトでは、第三者配信の広告サービス「Google AdSense」を利用しています。
            </p>
            <p style={pGapStyle}>
                Google AdSenseは、ユーザーの興味に応じた広告を表示するためにCookieを使用することがあります。
                Cookieを使用することで、当サイトや他のサイトへのアクセス情報に基づいて広告が配信されます。
            </p>
            <p style={pGapStyle}>
                ユーザーは、Googleの
                <ExtLink href="https://adssettings.google.com/">
                    広告設定ページ
                </ExtLink>
                からパーソナライズ広告を無効にすることができます。
            </p>
            <p style={pStyle}>
                Googleの広告およびCookieの使用については、
                <ExtLink href="https://policies.google.com/technologies/ads?hl=ja">
                    Googleの広告に関するポリシー
                </ExtLink>
                をご確認ください。
            </p>
        </Section>
    )
}

export function Section5() {
    return (
        <Section title="5. Google Analyticsについて">
            <p style={pGapStyle}>
                当サイトでは、Googleによるアクセス解析ツール「Google Analytics」を使用しています。
                Google Analyticsはトラフィックデータの収集のためにCookieを使用しています。
            </p>
            <p style={pGapStyle}>
                このトラフィックデータは匿名で収集されており、個人を特定するものではありません。
            </p>
            <p style={pGapStyle}>
                Google Analyticsによるデータ収集を無効にしたい場合は、Googleが提供する
                <ExtLink href="https://tools.google.com/dlpage/gaoptout?hl=ja">
                    オプトアウトアドオン
                </ExtLink>
                をご利用ください。
            </p>
            <p style={pStyle}>
                詳細については、
                <ExtLink href="https://policies.google.com/privacy?hl=ja">
                    Googleのプライバシーポリシー
                </ExtLink>
                をご確認ください。
            </p>
        </Section>
    )
}
