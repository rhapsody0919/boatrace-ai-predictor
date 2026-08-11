"""マイクロフト予想: モデル定義（学習/推論 共通）

構成（docs/design/mycroft-transformer-design.md）:
  ① フォームエンコーダ: 選手の過去32走を Transformer で読み、
     attention pooling で「今の状態」埋め込み e_i を作る（6艇で重み共有）
  ② レース相互作用ブロック: [e_i ⊕ 静的特徴量] に set-attention をかけ、
     「誰が誰に沈められるか」という6艇の関係を捉える（順序不変）
  ③ ヘッド: 艇ごとのスコア → Plackett-Luce 損失（1〜3着の逐次尤度）
     ＋ 補助損失（フォーム埋め込み単独での着順4クラス分類）

パラメータは意図的に小さく保つ（データ14万レースに対する過剰適合の回避）。
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as Fn

from mycroft_sequences import MAX_LEN, N_NUM, STATIC_CAT_SPECS, TOKEN_CAT_SPECS

NEG_INF = -1e9


class StaticEncoder(nn.Module):
    """静的特徴量（ワトソンと同じ36項目）→ 埋め込み。

    boat_number / venue_code などのカテゴリ列は標準化した連続値のままだと
    単調な効果しか表現できない（LightGBM はこれらをカテゴリとして扱っており、
    特に boat_number は全特徴量中で最重要）。カテゴリは埋め込みで受ける。
    """

    def __init__(self, n_cont: int, d_model: int, dropout: float):
        super().__init__()
        self.cat_emb = nn.ModuleList(
            [nn.Embedding(vocab, d_model) for _, vocab in STATIC_CAT_SPECS]
        )
        self.cont_proj = nn.Linear(n_cont, d_model)
        self.act = nn.GELU()
        self.norm = nn.LayerNorm(d_model)
        self.drop = nn.Dropout(dropout)

    def forward(self, cat, cont):
        x = self.cont_proj(cont)
        for i, emb in enumerate(self.cat_emb):
            x = x + emb(cat[..., i])
        return self.drop(self.norm(self.act(x)))


class FormEncoder(nn.Module):
    """選手の過去走トークン列 → フォーム埋め込み（6艇で重み共有）。"""

    def __init__(self, d_model=64, nhead=4, nlayers=2, dropout=0.2, max_len=MAX_LEN):
        super().__init__()
        self.cat_emb = nn.ModuleList(
            [nn.Embedding(vocab, d_model) for _, vocab in TOKEN_CAT_SPECS]
        )
        self.num_proj = nn.Linear(N_NUM, d_model)
        # 位置＝新しさ（0 が直近走）。日付そのものは log_days_ago で別途与える
        self.pos_emb = nn.Embedding(max_len, d_model)
        self.in_norm = nn.LayerNorm(d_model)
        self.in_drop = nn.Dropout(dropout)

        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=2 * d_model,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        # norm_first=True の Transformer は最終正規化が入らない。実測では pooling 後の
        # L2ノルムが 2.24 と、LayerNorm 済みの静的埋め込み（7.64）と桁が揃わなかった。
        # 融合前に両分岐のスケールを揃える。
        self.encoder = nn.TransformerEncoder(
            layer, num_layers=nlayers, norm=nn.LayerNorm(d_model)
        )
        self.attn_score = nn.Linear(d_model, 1)
        self.out_norm = nn.LayerNorm(d_model)
        # 履歴が1走も無い艇（新人・racer_id不明）のための学習可能な既定埋め込み
        self.empty_emb = nn.Parameter(torch.zeros(d_model))

    def forward(self, cat, num, mask):
        """cat:(B,L,C) num:(B,L,N) mask:(B,L)bool → (embedding (B,D), weights (B,L))"""
        b, length = mask.shape
        x = self.cat_emb[0](cat[..., 0])
        for i in range(1, len(self.cat_emb)):
            x = x + self.cat_emb[i](cat[..., i])
        pos = torch.arange(length, device=cat.device).unsqueeze(0).expand(b, length)
        x = x + self.num_proj(num) + self.pos_emb(pos)
        x = self.in_drop(self.in_norm(x))

        has_any = mask.any(dim=1)
        # 全トークン無効の行は TransformerEncoder が NaN を返すため、先頭位置だけ
        # 有効扱いにして計算を通し、出力側で empty_emb に差し替える
        is_first = pos == 0
        pad = (~mask) & ~((~has_any).unsqueeze(1) & is_first)
        h = self.encoder(x, src_key_padding_mask=pad)

        score = self.attn_score(h).squeeze(-1).masked_fill(~mask, NEG_INF)
        # 全マスク行の softmax は一様分布になるため、mask 乗算で 0 に潰す
        weights = torch.softmax(score, dim=1) * mask.float()
        emb = torch.bmm(weights.unsqueeze(1), h).squeeze(1)
        emb = torch.where(has_any.unsqueeze(1), emb, self.empty_emb.expand_as(emb))
        return self.out_norm(emb), weights


class Mycroft(nn.Module):
    """フォームエンコーダ + レース相互作用 + ランキングヘッド。"""

    def __init__(
        self,
        n_static_cont: int,
        d_model=64,
        nhead=4,
        nlayers=2,
        dropout=0.2,
        max_len=MAX_LEN,
        n_boats=6,
        ablation="none",
    ):
        super().__init__()
        self.n_boats = n_boats
        # 診断用: どちらの分岐が効いているかを切り分ける
        self.ablation = ablation
        self.form = FormEncoder(d_model, nhead, nlayers, dropout, max_len)
        self.static = StaticEncoder(n_static_cont, d_model, dropout)
        self.fuse = nn.Linear(2 * d_model, d_model)
        self.inter_attn = nn.MultiheadAttention(
            d_model, nhead, dropout=dropout, batch_first=True
        )
        self.norm1 = nn.LayerNorm(d_model)
        self.ff = nn.Sequential(
            nn.Linear(d_model, 2 * d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(2 * d_model, d_model),
        )
        self.norm2 = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, 1)
        # 補助タスク: フォーム埋め込みのみで着順4クラス（1/2/3着・着外）を当てる
        self.aux_head = nn.Linear(d_model, 4)

    def forward(self, cat, num, mask, static_cat, static_cont):
        """cat:(B,6,L,C) num:(B,6,L,N) mask:(B,6,L)
        static_cat:(B,6,Sc) static_cont:(B,6,Sn)"""
        b, k, length, n_cat = cat.shape
        emb, weights = self.form(
            cat.reshape(b * k, length, n_cat),
            num.reshape(b * k, length, -1),
            mask.reshape(b * k, length),
        )
        aux_logits = self.aux_head(emb).reshape(b, k, 4)
        emb = emb.reshape(b, k, -1)

        static_emb = self.static(static_cat, static_cont)
        if self.ablation == "static-only":
            emb = torch.zeros_like(emb)
        elif self.ablation == "form-only":
            static_emb = torch.zeros_like(static_emb)
        h = self.fuse(torch.cat([emb, static_emb], dim=-1))
        attended, _ = self.inter_attn(h, h, h, need_weights=False)
        h = self.norm1(h + attended)
        h = self.norm2(h + self.ff(h))
        score = self.head(h).squeeze(-1)
        return score, aux_logits, weights.reshape(b, k, length)


def plackett_luce_loss(score: torch.Tensor, ranks: torch.Tensor) -> torch.Tensor:
    """1〜3着の逐次選択尤度（Plackett-Luce）の負対数尤度。

    score: (B, 6) / ranks: (B, 3) 各着順の艇インデックス（0-5、未確定は -1）
    """
    b, k = score.shape
    available = torch.ones_like(score, dtype=torch.bool)
    total = score.new_zeros(b)
    count = score.new_zeros(b)

    for step in range(ranks.shape[1]):
        target = ranks[:, step]
        ok = target >= 0
        safe = target.clamp(min=0)
        masked = score.masked_fill(~available, NEG_INF)
        logp = torch.log_softmax(masked, dim=1)
        picked = logp.gather(1, safe.unsqueeze(1)).squeeze(1)
        total = total + torch.where(ok, -picked, torch.zeros_like(picked))
        count = count + ok.float()
        chosen = Fn.one_hot(safe, k).bool() & ok.unsqueeze(1)
        available = available & ~chosen

    return (total / count.clamp(min=1)).mean()
