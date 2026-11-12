import { h2Style, linkStyle, sectionStyle } from './privacyStyles.js'

// 条ひとつ分の枠（見出し h2 ＋ 本文）
export function Section({ title, children }) {
    return (
        <section style={sectionStyle}>
            <h2 style={h2Style}>
                {title}
            </h2>
            {children}
        </section>
    )
}

// 外部リンク（別タブ）
export function ExtLink({ href, children }) {
    return (
        <a href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}>
            {children}
        </a>
    )
}
