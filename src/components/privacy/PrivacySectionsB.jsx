import { Link } from 'react-router-dom'
import { Section } from './PrivacyParts.jsx'
import { linkStyle, pGapStyle, pStyle, ulGapStyle, ulStyle } from './privacyStyles.js'

export function Section6() {
    return (
        <Section title="6. Cookieについて">
            <p style={pGapStyle}>
                Cookieとは、Webサイトがユーザーのブラウザに送信する小さなテキストファイルです。
                当サイトでは、以下の目的でCookieを使用します：
            </p>
            <ul style={ulGapStyle}>
                <li>ユーザーの利便性向上のため</li>
                <li>サイトの利用状況を把握するため（Google Analytics）</li>
                <li>広告配信のため（Google AdSense）</li>
                <li>Cookie同意設定の保存のため</li>
            </ul>
            <p style={pGapStyle}>
                当サイトでは初回アクセス時にCookie同意バナーを表示し、ユーザーの同意を得た場合にのみGoogle Analytics及びGoogle AdSenseのCookieを使用します。
            </p>
            <p style={pStyle}>
                ブラウザの設定でCookieを無効にすることも可能ですが、一部機能が利用できなくなる場合があります。
            </p>
        </Section>
    )
}

export function Section7() {
    return (
        <Section title="7. 個人情報の第三者提供">
            <p style={pStyle}>
                当サイトは、以下の場合を除き、個人情報を第三者に提供することはありません：
            </p>
            <ul style={ulStyle}>
                <li>ユーザーの同意がある場合</li>
                <li>法令に基づく場合</li>
                <li>人の生命、身体または財産の保護のために必要がある場合</li>
            </ul>
        </Section>
    )
}

export function Section8() {
    return (
        <Section title="8. 免責事項">
            <p style={pGapStyle}>
                当サイトが提供するボートレース予測情報は、参考情報として提供するものです。
            </p>
            <p style={pGapStyle}>
                当サイトの情報を利用して生じたいかなる損害についても、当サイトは一切の責任を負いません。
                舟券の購入は自己責任で行ってください。
            </p>
            <p style={pStyle}>
                また、当サイトから他のサイトへのリンクについても、リンク先の内容について責任を負いません。
            </p>
        </Section>
    )
}

export function Section9() {
    return (
        <Section title="9. プライバシーポリシーの変更">
            <p style={pStyle}>
                当サイトは、必要に応じて本プライバシーポリシーを変更することがあります。
                変更後のプライバシーポリシーは、本ページに掲載した時点から効力を生じるものとします。
            </p>
        </Section>
    )
}

export function Section10() {
    return (
        <Section title="10. お問い合わせ">
            <p style={pStyle}>
                本プライバシーポリシーに関するお問い合わせは、
                <Link to="/contact" style={linkStyle}>
                    お問い合わせページ
                </Link>
                からご連絡ください。
            </p>
        </Section>
    )
}
