import { Link } from 'react-router-dom'
import { Section1, Section2, Section3, Section4, Section5 } from './privacy/PrivacySectionsA.jsx'
import { Section6, Section7, Section8, Section9, Section10 } from './privacy/PrivacySectionsB.jsx'

export default function PrivacyPolicy() {
    return (
        <>
                <title>プライバシーポリシー | 龍神レーダー</title>
                <meta name="description" content="龍神レーダー（AIボートレース分析サービス）のプライバシーポリシー。個人情報の取り扱い、Cookie使用、広告配信についてご説明します。" />
                <link rel="canonical" href="https://www.boat-ai.jp/privacy" />
            <div style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: '2rem',
            backgroundColor: 'var(--surface-page)',
            minHeight: '100vh'
        }}>
            <h1 style={{
                fontSize: '2rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                marginBottom: '1.5rem',
                borderBottom: '3px solid #0ea5e9',
                paddingBottom: '0.5rem'
            }}>
                プライバシーポリシー
            </h1>

            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                最終更新日: 2025年12月9日
            </p>

            <Section1 />
            <Section2 />
            <Section3 />
            <Section4 />
            <Section5 />
            <Section6 />
            <Section7 />
            <Section8 />
            <Section9 />
            <Section10 />

            <div style={{
                marginTop: '3rem',
                padding: '1.5rem',
                backgroundColor: 'var(--surface-card)',
                borderRadius: '8px',
                textAlign: 'center'
            }}>
                <Link to="/" style={{
                    color: 'var(--brand-accent-secondary)',
                    textDecoration: 'none',
                    fontSize: '1rem',
                    fontWeight: '600'
                }}>
                    ← トップページに戻る
                </Link>
            </div>
            </div>
        </>
    )
}
