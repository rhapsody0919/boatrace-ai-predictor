export default function Contact() {
    return (
        <div style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: '2rem',
            backgroundColor: '#ffffff',
            minHeight: '100vh'
        }}>
            <h1 style={{
                fontSize: '2rem',
                fontWeight: '700',
                color: '#0f172a',
                marginBottom: '1.5rem',
                borderBottom: '3px solid #0ea5e9',
                paddingBottom: '0.5rem'
            }}>
                お問い合わせ
            </h1>

            <p style={{
                color: '#475569',
                lineHeight: '1.8',
                marginBottom: '2rem'
            }}>
                ボートレースAI予測に関するご質問、ご意見、ご要望などがございましたら、以下のフォームよりお気軽にお問い合わせください。
            </p>

            <div style={{
                backgroundColor: '#f1f5f9',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '2rem',
                border: '1px solid #cbd5e1'
            }}>
                <h2 style={{
                    fontSize: '1.25rem',
                    fontWeight: '600',
                    color: '#1e293b',
                    marginBottom: '1rem'
                }}>
                    お問い合わせ前にご確認ください
                </h2>
                <ul style={{
                    color: '#475569',
                    lineHeight: '1.8',
                    paddingLeft: '1.5rem'
                }}>
                    <li>舟券の購入代行や推奨は一切行っておりません</li>
                    <li>予測結果に関する保証は提供していません</li>
                    <li>回答までに数日かかる場合があります</li>
                    <li>内容によっては回答できない場合があります</li>
                </ul>
            </div>

            {/* Googleフォーム埋め込みエリア */}
            <div style={{
                marginBottom: '2rem'
            }}>
                <iframe
                    src="https://docs.google.com/forms/d/e/1FAIpQLSeiioPc2vCicOWbKogOXTVAcfaZD31vZHQgltI_K8ENpQFTzg/viewform?embedded=true"
                    width="100%"
                    height="721"
                    frameBorder="0"
                    marginHeight="0"
                    marginWidth="0"
                    style={{
                        maxWidth: '640px',
                        margin: '0 auto',
                        display: 'block',
                        border: 'none',
                        borderRadius: '8px'
                    }}
                >
                    読み込んでいます…
                </iframe>
            </div>

            <div style={{
                backgroundColor: '#f1f5f9',
                padding: '1.5rem',
                borderRadius: '8px',
                marginBottom: '2rem'
            }}>
                <h2 style={{
                    fontSize: '1.25rem',
                    fontWeight: '600',
                    color: '#1e293b',
                    marginBottom: '1rem'
                }}>
                    よくある質問
                </h2>

                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#1e293b',
                        marginBottom: '0.5rem'
                    }}>
                        Q. 予測の精度はどのくらいですか？
                    </h3>
                    <p style={{ color: '#475569', lineHeight: '1.8', marginLeft: '1rem' }}>
                        A. 単勝的中率は約27%、複勝的中率は約66%です。詳細は
                        <a href="#accuracy" style={{ color: '#0ea5e9', textDecoration: 'underline' }}>
                            精度ダッシュボード
                        </a>
                        をご確認ください。
                    </p>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#1e293b',
                        marginBottom: '0.5rem'
                    }}>
                        Q. 舟券の購入代行はしてもらえますか？
                    </h3>
                    <p style={{ color: '#475569', lineHeight: '1.8', marginLeft: '1rem' }}>
                        A. いいえ、当サイトは予測情報の提供のみを行っており、舟券の購入代行や推奨は一切行っておりません。
                    </p>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#1e293b',
                        marginBottom: '0.5rem'
                    }}>
                        Q. データの更新頻度は？
                    </h3>
                    <p style={{ color: '#475569', lineHeight: '1.8', marginLeft: '1rem' }}>
                        A. レース結果は自動で収集され、精度データは随時更新されています。
                    </p>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#1e293b',
                        marginBottom: '0.5rem'
                    }}>
                        Q. AIの予測ロジックを教えてもらえますか？
                    </h3>
                    <p style={{ color: '#475569', lineHeight: '1.8', marginLeft: '1rem' }}>
                        A. Claude Sonnet 4.5を使用した大規模言語モデルによる予測を行っています。
                        選手成績、直近のレース結果、モーター情報などを総合的に分析しています。
                    </p>
                </div>
            </div>

            <div style={{
                marginTop: '3rem',
                padding: '1.5rem',
                backgroundColor: '#f1f5f9',
                borderRadius: '8px',
                textAlign: 'center'
            }}>
                <a href="#races" style={{
                    color: '#0ea5e9',
                    textDecoration: 'none',
                    fontSize: '1rem',
                    fontWeight: '600'
                }}>
                    ← トップページに戻る
                </a>
            </div>
        </div>
    )
}
