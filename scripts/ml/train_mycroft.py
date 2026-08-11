"""マイクロフト予想: Transformer（選手履歴系列）の学習

ワトソン（LambdaRank）が集計済みスカラーを見るのに対し、マイクロフトは
選手ごとの過去32走の「並び」そのものを読む。調子の波の形状・モーター慣れ・
相手文脈つきの成績など、集計で消える情報を捉えることを狙う。

評価はワトソンと同一の time_split・同一指標で行い、さらに:
  - ΔR²（Benter結合 − オッズ単独）: 市場への上乗せ情報があるか
  - ワトソンとのアンサンブル増分: 系列情報が「新しい情報」かどうかの本質検定

実行:
  scripts/ml/.venv-torch/bin/python scripts/ml/train_mycroft.py
出力:
  scripts/ml/models/mycroft_v1.pt     学習済みモデル一式
  data/ml/report_mycroft_v1.json      評価レポート
  data/mycroft/model.json             フロント表示用メタデータ（git管理）
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import log_loss, roc_auc_score

import features as F
import mycroft_sequences as MS
import benter_eval as BE
import watson_scores as WS
from mycroft_model import Mycroft, plackett_luce_loss

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)
MYCROFT_DIR = Path(__file__).resolve().parents[2] / "data" / "mycroft"

SEED = 42
BATCH_SIZE = 256
MAX_EPOCHS = 40
PATIENCE = 4
LR = 1e-3
WEIGHT_DECAY = 1e-2
AUX_WEIGHT = 0.1
WARMUP_EPOCHS = 1
RELEVANCE = {1: 3, 2: 2, 3: 1, 0: 0}


def pick_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ---------------------------------------------------------------------------
# データ準備
# ---------------------------------------------------------------------------

def quality_matched_split(df: pd.DataFrame):
    """データ品質が揃うように train / cal / test を切り直す。

    F.time_split（70/15/15）の cal 期間は、公式アーカイブのバックフィルと
    Supabase 蓄積分の境目に重なり、展示あり31%・racer_id欠損37%と品質が崩れる
    （train 100%/0%、test 95%/0%）。この cal で早期終了と温度校正を行うと、
    学習にも本番にも似ていない領域に最適化してしまう。

    そこで test 期間の先頭30%を cal として切り出し、cal と test の品質を揃える。
    時系列順（cal → test）は保たれるためリークは無い。移行期の低品質データは
    train 側に残し、欠損に対する頑健性を学習させる。
    """
    _, _, orig_test = F.time_split(df)
    order = (
        orig_test.drop_duplicates("race_id")
        .sort_values(["race_date", "race_id"])["race_id"]
        .tolist()
    )
    cut = int(len(order) * 0.3)
    cal_ids, test_ids = set(order[:cut]), set(order[cut:])
    train = df[~df["race_id"].isin(cal_ids | test_ids)]
    return (
        train,
        orig_test[orig_test["race_id"].isin(cal_ids)],
        orig_test[orig_test["race_id"].isin(test_ids)],
    )


def build_race_arrays(df: pd.DataFrame, race_index: dict, race_ids):
    """レース単位の (行番号6つ, 1〜3着の艇インデックス) を作る。

    着順が3つとも判明しているレースのみを対象にする。
    """
    finish = pd.to_numeric(df["finish_pos"], errors="coerce").to_numpy()
    rows_list, ranks_list, kept = [], [], []
    for rid in race_ids:
        rows = race_index.get(rid)
        if rows is None:
            continue
        fin = finish[rows]
        ranks = []
        for place in (1, 2, 3):
            hit = np.flatnonzero(fin == place)
            ranks.append(int(hit[0]) if len(hit) == 1 else -1)
        if any(r < 0 for r in ranks):
            continue
        rows_list.append(rows)
        ranks_list.append(ranks)
        kept.append(rid)
    return (
        np.asarray(rows_list, dtype=np.int64),
        np.asarray(ranks_list, dtype=np.int64),
        np.asarray(kept, dtype=object),
    )


def build_static(df: pd.DataFrame):
    """静的特徴量をワトソン互換の順序で並べた生行列（ワトソン比較用）。"""
    return df[F.FEATURE_COLS].astype(np.float32).to_numpy()


class RaceBatcher:
    """レース単位のミニバッチを numpy gather → torch で供給する。"""

    def __init__(
        self, store, static_cat, static_cont, race_rows, race_ranks, batch_size, device
    ):
        self.store = store
        self.static_cat = static_cat
        self.static_cont = static_cont
        self.race_rows = race_rows
        self.race_ranks = race_ranks
        self.batch_size = batch_size
        self.device = device

    def __len__(self):
        return int(np.ceil(len(self.race_rows) / self.batch_size))

    def batches(self, shuffle=False, rng=None):
        order = np.arange(len(self.race_rows))
        if shuffle:
            (rng or np.random).shuffle(order)
        for start in range(0, len(order), self.batch_size):
            sel = order[start : start + self.batch_size]
            rows = self.race_rows[sel]
            flat = rows.reshape(-1)
            cat, num, mask = self.store.gather(flat)
            b, k = rows.shape
            yield (
                torch.from_numpy(cat).view(b, k, cat.shape[1], cat.shape[2]).to(self.device),
                torch.from_numpy(num).view(b, k, num.shape[1], num.shape[2]).to(self.device),
                torch.from_numpy(mask).view(b, k, mask.shape[1]).to(self.device),
                torch.from_numpy(self.static_cat[flat]).view(b, k, -1).to(self.device),
                torch.from_numpy(self.static_cont[flat]).view(b, k, -1).to(self.device),
                torch.from_numpy(self.race_ranks[sel]).to(self.device),
                sel,
            )


# ---------------------------------------------------------------------------
# 評価（ワトソンと同一定義）
# ---------------------------------------------------------------------------

def softmax_rows(scores: np.ndarray, scale: float = 1.0) -> np.ndarray:
    s = scale * scores
    s = s - s.max(axis=1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(axis=1, keepdims=True)


def winner_loglik_arr(probs: np.ndarray, ranks: np.ndarray) -> float:
    p = probs[np.arange(len(probs)), ranks[:, 0]]
    return float(np.sum(np.log(np.clip(p, 1e-12, None))))


def fit_temperature(scores: np.ndarray, ranks: np.ndarray) -> float:
    return BE.golden_section_max(
        lambda a: winner_loglik_arr(softmax_rows(scores, a), ranks), 0.05, 10.0
    )


def ndcg_at_k_arr(scores: np.ndarray, ranks: np.ndarray, k: int) -> float:
    n, n_boats = scores.shape
    rel = np.zeros((n, n_boats), dtype=np.float64)
    for place, gain in ((0, 3), (1, 2), (2, 1)):
        rel[np.arange(n), ranks[:, place]] = gain
    order = np.argsort(-scores, axis=1)[:, :k]
    rel_pred = np.take_along_axis(rel, order, axis=1)
    rel_best = np.sort(rel, axis=1)[:, ::-1][:, :k]
    disc = 1 / np.log2(np.arange(2, k + 2))
    dcg = ((2**rel_pred - 1) * disc).sum(axis=1)
    idcg = ((2**rel_best - 1) * disc).sum(axis=1)
    valid = idcg > 0
    return float(np.mean(dcg[valid] / idcg[valid]))


def compute_metrics(scores: np.ndarray, probs: np.ndarray, ranks: np.ndarray) -> dict:
    n = len(scores)
    y_win = np.zeros(scores.shape, dtype=int)
    y_win[np.arange(n), ranks[:, 0]] = 1
    top1 = float(np.mean(np.argmax(scores, axis=1) == ranks[:, 0]))
    return {
        "top1_hit_rate": round(top1, 4),
        "winner_logloss": round(
            float(log_loss(y_win.ravel(), np.clip(probs.ravel(), 1e-6, 1 - 1e-6))), 4
        ),
        "auc": round(float(roc_auc_score(y_win.ravel(), scores.ravel())), 4),
        "ndcg_at_1": round(ndcg_at_k_arr(scores, ranks, 1), 4),
        "ndcg_at_3": round(ndcg_at_k_arr(scores, ranks, 3), 4),
    }


# ---------------------------------------------------------------------------
# 学習
# ---------------------------------------------------------------------------

def run_epoch(model, batcher, optimizer=None, rng=None, scheduler=None):
    """1エポック実行し、(PL損失, 補助損失) の平均を返す。

    合算値だけを見ると「補助タスクが良くなっただけ」の改善を順位改善と
    取り違えるため、常に分解して記録する。
    """
    train = optimizer is not None
    model.train(train)
    pl_total, aux_total, n_batches = 0.0, 0.0, 0
    with torch.set_grad_enabled(train):
        for cat, num, mask, s_cat, s_cont, ranks, _ in batcher.batches(
            shuffle=train, rng=rng
        ):
            score, aux_logits, _ = model(cat, num, mask, s_cat, s_cont)
            loss = plackett_luce_loss(score, ranks)
            # 補助損失: フォーム埋め込み単独で着順4クラス（0=1着,1=2着,2=3着,3=着外）
            aux_target = torch.full(score.shape, 3, dtype=torch.long, device=score.device)
            for place in range(3):
                aux_target.scatter_(1, ranks[:, place : place + 1], place)
            aux = torch.nn.functional.cross_entropy(
                aux_logits.reshape(-1, 4), aux_target.reshape(-1)
            )
            pl_total += float(loss.detach())
            aux_total += float(aux.detach())
            loss = loss + AUX_WEIGHT * aux
            if train:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                if scheduler is not None:
                    scheduler.step()
            n_batches += 1
    denom = max(n_batches, 1)
    return pl_total / denom, aux_total / denom


@torch.no_grad()
def predict_scores(model, batcher):
    model.eval()
    out = np.zeros((len(batcher.race_rows), 6), dtype=np.float32)
    for cat, num, mask, s_cat, s_cont, _, sel in batcher.batches():
        score, _, _ = model(cat, num, mask, s_cat, s_cont)
        out[sel] = score.float().cpu().numpy()
    return out


def watson_scores_for(static_raw: np.ndarray, race_rows: np.ndarray):
    """比較・アンサンブル用にワトソンのスコアを同じレース集合で計算する。

    LightGBM は torch と OpenMP ランタイムが衝突するため子プロセスに隔離する
    （watson_scores.py 参照）。
    """
    flat = race_rows.reshape(-1)
    raw = WS.score_via_subprocess(static_raw[flat], F.DATA_DIR / "_tmp")
    return None if raw is None else raw.reshape(race_rows.shape)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="auto")
    parser.add_argument("--epochs", type=int, default=MAX_EPOCHS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--limit-train-races", type=int, default=0,
                        help="スモークテスト用に学習レース数を制限する")
    parser.add_argument("--ablation", choices=["none", "static-only", "form-only"],
                        default="none",
                        help="診断用: 片方の分岐だけで学習し、寄与を切り分ける")
    parser.add_argument("--no-save", action="store_true",
                        help="診断実行: モデル・レポートを保存しない")
    args = parser.parse_args()

    torch.manual_seed(SEED)
    np.random.seed(SEED)
    rng = np.random.default_rng(SEED)
    device = pick_device(args.device)
    print(f"🖥️  device: {device}")

    print("📥 データ読み込み・特徴量構築...")
    raw_df, raw_st = MS.load_raw()
    df = F.build_features(raw_df, raw_st)
    train_df, cal_df, test_df = quality_matched_split(df)
    print(
        f"  train={train_df['race_id'].nunique()}R  cal={cal_df['race_id'].nunique()}R  "
        f"test={test_df['race_id'].nunique()}R（品質を揃えた分割）"
    )
    for name, part in (("train", train_df), ("cal", cal_df), ("test", test_df)):
        print(
            f"    {name:5s} {str(part['race_date'].min())[:10]}〜"
            f"{str(part['race_date'].max())[:10]} "
            f"展示あり {part['exhibition_time'].notna().mean():.0%}"
        )

    print("🧩 系列ストア構築...")
    store = MS.SequenceStore(df, raw_st)
    race_index = MS.build_race_index(store.df)

    splits = {}
    for name, part in (("train", train_df), ("cal", cal_df), ("test", test_df)):
        rows, ranks, kept = build_race_arrays(
            store.df, race_index, part["race_id"].unique()
        )
        splits[name] = {"rows": rows, "ranks": ranks, "race_ids": kept}
        print(f"  {name}: {len(rows):,}レース（6艇揃い・着順確定）")

    if args.limit_train_races:
        s = splits["train"]
        s["rows"] = s["rows"][: args.limit_train_races]
        s["ranks"] = s["ranks"][: args.limit_train_races]
        s["race_ids"] = s["race_ids"][: args.limit_train_races]
        print(f"  ⚠️ スモークモード: train を {len(s['rows'])}レースに制限")

    # 静的特徴量の標準化（train 統計のみ使用。欠損は 0＝平均に寄せる）
    static_raw = build_static(store.df)  # ワトソン比較用（FEATURE_COLS 順）
    static_cat, static_cont_raw = MS.split_static(store.df)
    train_rows = splits["train"]["rows"].reshape(-1)
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(static_cont_raw[train_rows], axis=0)
        std = np.nanstd(static_cont_raw[train_rows], axis=0)
    # 全欠損の列（学習期間に一度も観測されない特徴量）は平均0・分散1に倒す
    mean = np.nan_to_num(mean, nan=0.0)
    std = np.where(~np.isfinite(std) | (std < 1e-6), 1.0, std)
    static_cont = np.nan_to_num(
        (static_cont_raw - mean) / std, nan=0.0
    ).astype(np.float32)

    # トークン連続値も train 統計で標準化する（フラグ列はそのまま）
    sample_rows = rng.choice(train_rows, size=min(200_000, len(train_rows)), replace=False)
    _, num_sample, mask_sample = store.gather(sample_rows)
    flat = num_sample[mask_sample]
    tok_mean = flat.mean(axis=0)
    tok_std = np.where(flat.std(axis=0) < 1e-6, 1.0, flat.std(axis=0))
    for i, name in enumerate(MS.TOKEN_NUM_NAMES):
        if name in ("exh_missing", "same_series"):
            tok_mean[i], tok_std[i] = 0.0, 1.0
    store.set_num_norm(tok_mean, tok_std)

    batchers = {
        name: RaceBatcher(
            store,
            static_cat,
            static_cont,
            s["rows"],
            s["ranks"],
            args.batch_size,
            device,
        )
        for name, s in splits.items()
    }

    model = Mycroft(
        n_static_cont=static_cont.shape[1], ablation=args.ablation
    ).to(device)
    if args.ablation != "none":
        print(f"  🔬 アブレーション: {args.ablation}")
    n_params = sum(p.numel() for p in model.parameters())
    print(f"🧠 モデル構築: {n_params:,} パラメータ")

    # 埋め込み・LayerNorm・バイアスは weight decay の対象外にする（標準的な作法。
    # 特に boat_number 埋め込みは主要な信号源で、減衰させると学習が進まない）
    decay, no_decay = [], []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if param.ndim <= 1 or "emb" in name:
            no_decay.append(param)
        else:
            decay.append(param)
    optimizer = torch.optim.AdamW(
        [
            {"params": decay, "weight_decay": WEIGHT_DECAY},
            {"params": no_decay, "weight_decay": 0.0},
        ],
        lr=LR,
    )
    # Transformer は warmup 無しだと初期の大きな更新で早々に停滞しやすい
    steps_per_epoch = max(len(batchers["train"]), 1)
    warmup_steps = WARMUP_EPOCHS * steps_per_epoch
    total_steps = args.epochs * steps_per_epoch

    def lr_lambda(step):
        if step < warmup_steps:
            return (step + 1) / max(warmup_steps, 1)
        progress = (step - warmup_steps) / max(total_steps - warmup_steps, 1)
        return 0.5 * (1 + np.cos(np.pi * min(progress, 1.0)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    best_loss, best_state, best_epoch, bad = float("inf"), None, 0, 0
    cal_ranks = splits["cal"]["ranks"]
    print("⚡ 学習開始...")
    for epoch in range(1, args.epochs + 1):
        tr_pl, tr_aux = run_epoch(model, batchers["train"], optimizer, rng, scheduler)
        ca_pl, ca_aux = run_epoch(model, batchers["cal"])
        # 早期終了は順位そのものの損失（PL）で判断する。補助損失は監視のみ
        cal_top1 = float(
            np.mean(np.argmax(predict_scores(model, batchers["cal"]), axis=1)
                    == cal_ranks[:, 0])
        )
        flag = ""
        if ca_pl < best_loss - 1e-4:
            best_loss, best_epoch, bad = ca_pl, epoch, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            flag = " ← best"
        else:
            bad += 1
        print(
            f"  epoch {epoch:2d}: train PL {tr_pl:.4f}/aux {tr_aux:.4f} | "
            f"cal PL {ca_pl:.4f}/aux {ca_aux:.4f} | cal top1 {cal_top1*100:.1f}%{flag}"
        )
        if bad >= PATIENCE:
            print(f"  early stopping（best epoch {best_epoch}）")
            break

    if best_state is not None:
        model.load_state_dict(best_state)

    print("🌡️ 勝率変換の温度フィット（calibration セット）...")
    cal_scores = predict_scores(model, batchers["cal"])
    temperature = fit_temperature(cal_scores, splits["cal"]["ranks"])
    print(f"    temperature = {temperature:.4f}")

    test_scores = predict_scores(model, batchers["test"])
    test_ranks = splits["test"]["ranks"]
    test_probs = softmax_rows(test_scores, temperature)
    metrics = compute_metrics(test_scores, test_probs, test_ranks)
    print(
        f"  top1的中率: {metrics['top1_hit_rate']*100:.1f}% | "
        f"勝者logloss: {metrics['winner_logloss']:.4f} | AUC: {metrics['auc']:.4f} | "
        f"NDCG@3: {metrics['ndcg_at_3']:.4f}"
    )

    # ---- ワトソンとの比較・アンサンブル ----
    vs_watson, ensemble = None, None
    w_test = watson_scores_for(static_raw, splits["test"]["rows"])
    w_cal = watson_scores_for(static_raw, splits["cal"]["rows"])
    if w_test is not None and w_cal is not None:
        w_temp = fit_temperature(w_cal, splits["cal"]["ranks"])
        w_probs = softmax_rows(w_test, w_temp)
        w_metrics = compute_metrics(w_test, w_probs, test_ranks)
        vs_watson = w_metrics
        print(
            f"  （同一条件）ワトソン: top1 {w_metrics['top1_hit_rate']*100:.1f}% | "
            f"logloss {w_metrics['winner_logloss']:.4f} | AUC {w_metrics['auc']:.4f}"
        )

        # 重み w を cal で最尤フィットし、test で評価する
        m_cal_p = softmax_rows(cal_scores, temperature)
        w_cal_p = softmax_rows(w_cal, w_temp)

        def blend(pm, pw, weight):
            z = weight * np.log(np.clip(pm, 1e-12, None)) + (1 - weight) * np.log(
                np.clip(pw, 1e-12, None)
            )
            z -= z.max(axis=1, keepdims=True)
            e = np.exp(z)
            return e / e.sum(axis=1, keepdims=True)

        best_w = BE.golden_section_max(
            lambda ww: winner_loglik_arr(
                blend(m_cal_p, w_cal_p, ww), splits["cal"]["ranks"]
            ),
            0.0,
            1.0,
        )
        ens_probs = blend(test_probs, w_probs, best_w)
        ens_metrics = compute_metrics(np.log(ens_probs), ens_probs, test_ranks)
        ensemble = {
            "mycroft_weight": round(float(best_w), 4),
            **ens_metrics,
            "logloss_gain_vs_watson": round(
                w_metrics["winner_logloss"] - ens_metrics["winner_logloss"], 4
            ),
            "top1_gain_vs_watson": round(
                ens_metrics["top1_hit_rate"] - w_metrics["top1_hit_rate"], 4
            ),
        }
        print(
            f"  🤝 アンサンブル(w={best_w:.2f}): top1 {ens_metrics['top1_hit_rate']*100:.1f}% | "
            f"logloss {ens_metrics['winner_logloss']:.4f} "
            f"(ワトソン比 {ensemble['logloss_gain_vs_watson']:+.4f})"
        )

    # ---- ΔR²（Benter結合 vs オッズ単独）----
    print("📈 ΔR² 評価（Benter結合 vs オッズ単独）...")
    delta = None
    odds_long = BE.load_odds()
    if odds_long is not None:
        frames = []
        for name in ("cal", "test"):
            s = splits[name]
            sc = cal_scores if name == "cal" else test_scores
            probs = softmax_rows(sc, temperature)
            rows = s["rows"].reshape(-1)
            frames.append(
                pd.DataFrame(
                    {
                        "race_id": store.race_ids[rows],
                        "boat_number": store.boat_numbers[rows].astype(int),
                        "race_date": store.df["race_date"].to_numpy()[rows],
                        "finish_pos": pd.to_numeric(
                            store.df["finish_pos"], errors="coerce"
                        ).to_numpy()[rows],
                        "f": probs.reshape(-1),
                    }
                )
            )
        d_all = pd.concat(frames, ignore_index=True)
        d_odds = d_all.merge(odds_long, on=["race_id", "boat_number"], how="inner")
        full = d_odds.groupby("race_id")["boat_number"].size()
        d_odds = d_odds[d_odds["race_id"].isin(full[full == 6].index)]
        if d_odds["race_id"].nunique() >= 200:
            delta = BE.eval_delta_r2(d_odds)
            print(
                f"    R²: マイクロフト単独 {delta['r2']['model_only']:.4f} / "
                f"オッズ単独 {delta['r2']['odds_only']:.4f} / "
                f"結合 {delta['r2']['combined']:.4f} → ΔR² = {delta['delta_r2']:+.4f} "
                f"(eval {delta['n_eval_races']}R)"
            )
        else:
            print(f"    ⚠️ オッズありレース不足（{d_odds['race_id'].nunique()}R）→ スキップ")
    else:
        print("    ⚠️ odds.csv なし → スキップ")

    # ---- 保存 ----
    if args.no_save:
        print("\n⏭️ --no-save のため保存をスキップ（診断実行）")
        return
    trained_at = datetime.now(timezone.utc).isoformat()
    torch.save(
        {
            "state_dict": model.state_dict(),
            "config": {
                "n_static_cont": int(static_cont.shape[1]),
                "max_len": MS.MAX_LEN,
                "static_cont_cols": MS.STATIC_CONT_COLS,
                "static_cat_cols": MS.STATIC_CAT_COLS,
            },
            "static_mean": mean,
            "static_std": std,
            "token_mean": tok_mean,
            "token_std": tok_std,
            "temperature": temperature,
            "trained_at": trained_at,
        },
        MODEL_DIR / "mycroft_v1.pt",
    )

    report = {
        "model": "mycroft_v1",
        "architecture": "Transformer form-encoder + set-attention + Plackett-Luce",
        "n_params": int(n_params),
        "best_epoch": best_epoch,
        "temperature": round(float(temperature), 4),
        "n_train_races": int(len(splits["train"]["rows"])),
        "n_test_races": int(len(splits["test"]["rows"])),
        "metrics": metrics,
        "vs_watson_same_split": vs_watson,
        "ensemble_with_watson": ensemble,
        "delta_r2_eval": delta,
    }
    with open(F.DATA_DIR / "report_mycroft_v1.json", "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)

    MYCROFT_DIR.mkdir(parents=True, exist_ok=True)
    meta = {
        "model_id": "mycroft",
        "version": "v1",
        "trained_at": trained_at,
        "n_races": int(store.df["race_id"].nunique()),
        "n_params": int(n_params),
        "max_history": MS.MAX_LEN,
        "metrics": metrics,
        "vs_watson": vs_watson,
        "ensemble_with_watson": ensemble,
        "delta_r2": delta["delta_r2"] if delta else None,
        "delta_r2_detail": (
            {"r2": delta["r2"], "n_eval_races": delta["n_eval_races"]} if delta else None
        ),
    }
    with open(MYCROFT_DIR / "model.json", "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(
        f"\n✅ 保存: {MODEL_DIR/'mycroft_v1.pt'} / "
        f"{F.DATA_DIR/'report_mycroft_v1.json'} / {MYCROFT_DIR/'model.json'}"
    )


if __name__ == "__main__":
    main()
