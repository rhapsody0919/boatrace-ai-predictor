"""マイクロフト予想: 選手履歴の系列構築（学習/推論 共通）

各艇について「その選手の過去 MAX_LEN 走」をトークン列として組み立てる。
Transformer のフォームエンコーダはこの列を読み、集計済みスカラー
（win_rate や recent_win_rate）では失われる情報 — 調子の波の形状、
モーター慣れ、相手・コース文脈つきの成績 — を捉える。

リーク防止の原則:
  - トークンは対象レースより**厳密に過去の日付**のレースのみ（同日は除外）。
    race_id の辞書順は会場コード優先で時刻順ではないため、同日レースを
    含めると未来の情報が混入しうる。
  - 系列は選手ごとに (race_date, race_id) 昇順で並べ、自分より前の位置のみ参照。

学習と推論で同一のトークン定義を使うため、この 1 ファイルに集約する
（features.py を Poirot/Watson と共有しているのと同じ原則）。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import features as F

MAX_LEN = 32

# ---- トークンのカテゴリ特徴量（埋め込み次元は語彙数。0 は欠損/パディング）----
# (名前, 語彙数)
TOKEN_CAT_SPECS = [
    ("finish_code", 5),  # 0=不明, 1..3=着順, 4=着外
    ("course_code", 8),  # 0=不明, 1..6=進入コース, 7=予備
    ("venue_code", 25),  # 0=不明, 1..24=会場
    ("grade_code", 6),  # 0=不明, 1..5=一般/G3/G2/G1/SG
]
TOKEN_CAT_NAMES = [name for name, _ in TOKEN_CAT_SPECS]

# ---- トークンの連続値特徴量 ----
# 絶対量（そのレース単体で決まる値）
TOKEN_ABS_NUM = [
    "start_timing",  # 本番ST
    "exh_time_rank",  # 展示タイムのレース内順位
    "exh_st_rank",  # 展示STのレース内順位
    "motor_2rate",  # モーター2連率
    "opp_strength",  # 相手強度（他5艇の平均勝率）
    "exh_missing",  # 展示欠損フラグ
]
# 対象レースとの関係で決まる値（gather 時に計算）
TOKEN_REL_NUM = [
    "log_days_ago",  # log1p(経過日数)
    "same_series",  # 同会場かつ7日以内（＝同じモーターを使っている走）
]
TOKEN_NUM_NAMES = TOKEN_ABS_NUM + TOKEN_REL_NUM

N_CAT = len(TOKEN_CAT_SPECS)
N_NUM = len(TOKEN_NUM_NAMES)

# ---- 静的特徴量（ワトソンと同じ36項目）のカテゴリ/連続の切り分け ----
# LightGBM は F.CATEGORICAL_COLS をカテゴリとして扱う。特に boat_number は
# 全特徴量中で圧倒的に重要（コース優位）だが、標準化した連続値のまま線形層に
# 入れると単調な効果しか表現できない。同じ列を埋め込みで扱う。
# (名前, 語彙数)。値は +1 シフトして 0 を欠損に予約する。
STATIC_CAT_SPECS = [
    ("boat_number", 8),  # 1..6
    ("venue_code", 26),  # 1..24
    ("wind_direction_code", 18),  # 0..15
    ("weather_code", 6),  # 0..3
    ("race_grade_code", 7),  # 0..4
]
STATIC_CAT_COLS = [name for name, _ in STATIC_CAT_SPECS]
STATIC_CONT_COLS = [c for c in F.FEATURE_COLS if c not in STATIC_CAT_COLS]


def split_static(df: pd.DataFrame):
    """静的特徴量を (カテゴリID, 連続値) に分ける（学習/推論 共通）。

    Returns:
        cat:  (n, len(STATIC_CAT_SPECS)) int64  0 = 欠損
        cont: (n, len(STATIC_CONT_COLS)) float32 標準化前の生値（NaN あり）
    """
    cats = []
    for name, vocab in STATIC_CAT_SPECS:
        v = pd.to_numeric(df[name], errors="coerce").to_numpy()
        shifted = np.where(np.isnan(v), -1, v) + 1
        cats.append(np.clip(shifted, 0, vocab - 1).astype(np.int64))
    cat = np.stack(cats, axis=1)
    cont = df[STATIC_CONT_COLS].astype(np.float32).to_numpy()
    return cat, cont


def load_raw():
    """dataset.csv / start_timings.csv を backfill 込みで読む。

    features.load_dataset の読み込み部と同じ規則（重複 race_id は Supabase 側
    を優先）。build_features 前の生データと start_timings の両方が必要なため、
    共有コードを変更せずここに同等処理を置いている。
    整合性は self-test（--self-test）で F.load_dataset と突き合わせて検証する。
    """
    df = pd.read_csv(F.DATA_DIR / "dataset.csv")
    st = pd.read_csv(F.DATA_DIR / "start_timings.csv")

    bf_path = F.DATA_DIR / "backfill_dataset.csv"
    if bf_path.exists():
        bf = pd.read_csv(bf_path)
        bf_st = pd.read_csv(F.DATA_DIR / "backfill_start_timings.csv")
        supabase_ids = set(df["race_id"])
        bf = bf[~bf["race_id"].isin(supabase_ids)]
        bf_st = bf_st[~bf_st["race_id"].isin(supabase_ids)]
        print(
            f"  + backfill: {bf['race_id'].nunique():,}レース "
            f"({bf['race_date'].min()}〜{bf['race_date'].max()})"
        )
        df = pd.concat([bf, df], ignore_index=True)
        st = pd.concat([bf_st, st], ignore_index=True)

    return df, st


class SequenceStore:
    """行（1艇×1レース）単位のトークン素材と履歴インデックスを保持する。

    row_* 配列は「その行のレースが過去トークンになったときの中身」であり、
    hist[i, k] は行 i から見て k+1 番目に新しい過去レースの行番号（無ければ -1）。
    """

    def __init__(self, df: pd.DataFrame, st: pd.DataFrame, max_len: int = MAX_LEN):
        self.max_len = max_len
        d = df.reset_index(drop=True)

        # 本番ST（build_features は st_hist_mean しか結合しないため個別に結合）
        st_raw = st[["race_id", "boat_number", "start_timing"]].drop_duplicates(
            ["race_id", "boat_number"]
        )
        d = d.merge(st_raw, on=["race_id", "boat_number"], how="left")

        # ---- カテゴリ ----
        finish = pd.to_numeric(d["finish_pos"], errors="coerce")
        # 1..3 はそのまま、0（着外）は 4、欠損は 0（不明）
        finish_code = np.where(
            finish.isna(), 0, np.where(finish.to_numpy() == 0, 4, finish.fillna(0))
        )
        course = pd.to_numeric(d.get("actual_course"), errors="coerce")
        course_code = np.where(course.isna() | (course < 1) | (course > 6), 0, course)
        venue = pd.to_numeric(d["venue_code"], errors="coerce")
        venue_code = np.where(venue.isna() | (venue < 1) | (venue > 24), 0, venue)
        # race_grade_code は 0..4 → 埋め込みでは 1..5（0 を欠損に予約）
        grade = pd.to_numeric(d["race_grade_code"], errors="coerce")
        grade_code = np.where(grade.isna(), 0, grade + 1)

        self.row_cat = np.stack(
            [
                finish_code.astype(np.int16),
                course_code.astype(np.int16),
                venue_code.astype(np.int16),
                grade_code.astype(np.int16),
            ],
            axis=1,
        )

        # ---- 連続値（絶対量）----
        # 相手強度: 同レースの他5艇の平均勝率
        wr = pd.to_numeric(d["win_rate"], errors="coerce")
        grp = wr.groupby(d["race_id"])
        wr_sum = grp.transform("sum")
        wr_cnt = grp.transform("count")
        opp_strength = (wr_sum - wr.fillna(0)) / (wr_cnt - wr.notna().astype(int)).replace(
            0, np.nan
        )

        exh_missing = d["exhibition_time"].isna().astype(np.float32)

        abs_num = np.stack(
            [
                pd.to_numeric(d["start_timing"], errors="coerce").to_numpy(np.float32),
                pd.to_numeric(d["exh_time_rank"], errors="coerce").to_numpy(np.float32),
                pd.to_numeric(d["exh_st_rank"], errors="coerce").to_numpy(np.float32),
                pd.to_numeric(d["motor_2rate"], errors="coerce").to_numpy(np.float32),
                opp_strength.to_numpy(np.float32),
                exh_missing.to_numpy(np.float32),
            ],
            axis=1,
        )
        # 欠損は 0（標準化後の平均）とし、欠損有無は exh_missing / mask が伝える
        self.row_abs_num = np.nan_to_num(abs_num, nan=0.0).astype(np.float32)

        # ---- 相対量の材料 ----
        # datetime64 の単位は pandas のバージョン・パース経路で ns/us/ms と揺れる。
        # astype("int64") // 86400e9 は単位依存で壊れるため、Timedelta の日数で取る
        dt = pd.to_datetime(d["race_date"])
        date_int = (dt - pd.Timestamp("1970-01-01")).dt.days.to_numpy(np.int32)
        self.row_date = date_int
        self.row_venue = venue_code.astype(np.int16)

        # ---- 履歴インデックス ----
        racer = pd.to_numeric(d["racer_id"], errors="coerce").fillna(-1).to_numpy(np.int64)
        self.hist = self._build_hist(racer, date_int, d["race_id"].to_numpy(), max_len)

        # ---- 行の索引 ----
        self.race_ids = d["race_id"].to_numpy()
        self.race_dates = dt.dt.strftime("%Y-%m-%d").to_numpy()
        self.boat_numbers = pd.to_numeric(d["boat_number"], errors="coerce").to_numpy(
            np.int16
        )
        self.df = d

        # 連続値の標準化パラメータ（学習時に train 統計で設定し、推論時は
        # チェックポイントから復元する。未設定なら素通し）
        self._num_mean = np.zeros(N_NUM, dtype=np.float32)
        self._num_std = np.ones(N_NUM, dtype=np.float32)

    def set_num_norm(self, mean, std):
        """トークン連続値の標準化パラメータを設定する（学習/推論で共通）。"""
        self._num_mean = np.asarray(mean, dtype=np.float32).reshape(N_NUM)
        self._num_std = np.where(
            np.asarray(std, dtype=np.float32).reshape(N_NUM) < 1e-6,
            1.0,
            np.asarray(std, dtype=np.float32).reshape(N_NUM),
        ).astype(np.float32)

    @property
    def num_norm(self):
        return self._num_mean, self._num_std

    @staticmethod
    def _build_hist(racer, date_int, race_id, max_len):
        """選手ごとの時系列順に並べ、各行の直近 max_len 走の行番号を返す。

        racer_id 欠損行（backfill の一部）は -1 に揃うため、そのままだと
        「架空の同一選手」として互いの履歴を共有してしまう。該当行は履歴なし
        （空系列）として扱い、静的特徴量だけで推論させる。
        """
        n = len(racer)
        # 主キー: racer_id → race_date → race_id（lexsort は最後のキーが主）
        order = np.lexsort((race_id, date_int, racer))
        racer_sorted = racer[order]

        new_group = np.empty(n, dtype=bool)
        new_group[0] = True
        new_group[1:] = racer_sorted[1:] != racer_sorted[:-1]
        group_start = np.maximum.accumulate(
            np.where(new_group, np.arange(n, dtype=np.int64), 0)
        )
        pos = np.arange(n, dtype=np.int64) - group_start

        hist = np.full((n, max_len), -1, dtype=np.int32)
        # メモリ節約のためチャンク処理（n×max_len の int64 中間配列を避ける）
        chunk = 100_000
        ks = np.arange(max_len, dtype=np.int64)
        for s in range(0, n, chunk):
            e = min(s + chunk, n)
            idx = np.arange(s, e, dtype=np.int64)[:, None] - 1 - ks[None, :]
            valid = ks[None, :] < pos[s:e, None]
            src = np.where(valid, order[np.clip(idx, 0, None)], -1)
            hist[order[s:e]] = src.astype(np.int32)

        # racer_id 不明の行は履歴を持たせない（他人の走が混ざるのを防ぐ）
        hist[racer < 0] = -1
        return hist

    def gather(self, rows: np.ndarray):
        """指定行のトークン列を返す。

        Returns:
            cat:  (n, L, N_CAT) int64   カテゴリID（無効トークンは 0）
            num:  (n, L, N_NUM) float32 連続値（無効トークンは 0）
            mask: (n, L) bool            True = 有効トークン
        """
        rows = np.asarray(rows, dtype=np.int64)
        h = self.hist[rows]  # (n, L)
        valid = h >= 0
        safe = np.where(valid, h, 0)

        tgt_date = self.row_date[rows][:, None]
        tok_date = self.row_date[safe]
        days_ago = tgt_date - tok_date
        # 同日レースは除外（race_id の辞書順は時刻順ではないため未来混入を防ぐ）
        valid = valid & (days_ago >= 1)
        safe = np.where(valid, h, 0)

        cat = np.where(valid[:, :, None], self.row_cat[safe], 0).astype(np.int64)

        abs_num = self.row_abs_num[safe]
        log_days = np.log1p(np.maximum(days_ago, 0)).astype(np.float32)
        same_series = (
            (self.row_venue[safe] == self.row_venue[rows][:, None]) & (days_ago <= 7)
        ).astype(np.float32)
        num = np.concatenate(
            [abs_num, log_days[:, :, None], same_series[:, :, None]], axis=2
        )
        num = (num - self._num_mean) / self._num_std
        # 無効トークンは 0（＝標準化後の平均）に潰す。有効性は mask が伝える
        num = np.where(valid[:, :, None], num, 0.0).astype(np.float32)

        return cat, num, valid

    def token_race_info(self, row: int):
        """UI 表示用: 行 row のトークン位置ごとの過去レース情報。

        戻り値は長さ max_len のリストで、位置 k は gather が返す
        cat/num/mask の位置 k（＝attention 重みの位置）と対応する。
        無効トークンの位置は None。
        """
        out = []
        for h in self.hist[row]:
            if h < 0:
                out.append(None)
                continue
            days = int(self.row_date[row] - self.row_date[h])
            if days < 1:
                out.append(None)
                continue
            out.append(
                {
                    "race_id": str(self.race_ids[h]),
                    "race_date": str(self.race_dates[h]),
                    "venue_code": int(self.row_venue[h]),
                    "finish_code": int(self.row_cat[h, 0]),
                    "days_ago": days,
                }
            )
        return out


def build_race_index(df: pd.DataFrame, race_ids=None):
    """race_id → その6艇の行番号（艇番昇順）の対応を返す。

    6艇揃わないレース（データ欠損）は除外する。
    """
    d = df.reset_index(drop=True)
    idx = {}
    boat = pd.to_numeric(d["boat_number"], errors="coerce").to_numpy()
    order = np.lexsort((boat, d["race_id"].to_numpy()))
    rid_sorted = d["race_id"].to_numpy()[order]
    bounds = np.flatnonzero(
        np.concatenate(([True], rid_sorted[1:] != rid_sorted[:-1], [True]))
    )
    wanted = None if race_ids is None else set(race_ids)
    for s, e in zip(bounds[:-1], bounds[1:]):
        if e - s != 6:
            continue
        rid = rid_sorted[s]
        if wanted is not None and rid not in wanted:
            continue
        idx[rid] = order[s:e].astype(np.int64)
    return idx


def _self_test():
    """load_raw + build_features が F.load_dataset と一致することを確認する。"""
    raw_df, raw_st = load_raw()
    mine = F.build_features(raw_df, raw_st)
    theirs = F.load_dataset()
    assert len(mine) == len(theirs), f"行数不一致 {len(mine)} != {len(theirs)}"
    key = ["race_id", "boat_number"]
    a = mine.sort_values(key).reset_index(drop=True)
    b = theirs.sort_values(key).reset_index(drop=True)
    assert (a["race_id"].to_numpy() == b["race_id"].to_numpy()).all(), "race_id 不一致"
    for col in ["win_rate", "recent_win_rate", "st_hist_mean", "exh_time_rank"]:
        pd.testing.assert_series_equal(
            a[col], b[col], check_names=False, rtol=1e-9, atol=1e-9
        )
    print(f"✅ load_raw + build_features == F.load_dataset ({len(mine):,}行)")

    store = SequenceStore(mine, raw_st)
    idx = build_race_index(mine)
    print(f"✅ SequenceStore 構築: {len(mine):,}行 / 6艇揃いレース {len(idx):,}")

    # 日付整数化の健全性（datetime64 の単位揺れで日数が潰れる事故の検出）
    span = int(store.row_date.max() - store.row_date.min())
    expected = (mine["race_date"].max() - mine["race_date"].min()).days
    assert span == expected, f"❌ 日付日数が不正: span={span} expected={expected}"
    print(f"✅ 日付整数化OK（{span}日スパン）")

    # リーク検証: 全トークンが対象より過去の日付であること
    rng = np.random.default_rng(0)
    sample = rng.choice(len(mine), size=20000, replace=False)
    _, _, mask = store.gather(sample)
    h = store.hist[sample]
    tok_date = np.where(mask, store.row_date[np.where(h >= 0, h, 0)], -1)
    tgt_date = store.row_date[sample][:, None]
    assert not np.any(mask & (tok_date >= tgt_date)), "❌ 同日/未来のトークンが混入"
    print(f"✅ リーク検証OK（同日・未来トークンなし）")

    # 同一選手であることの検証（racer_id 不明行は「履歴なし」であることを確認）
    racer = pd.to_numeric(store.df["racer_id"], errors="coerce").fillna(-1).to_numpy()
    tok_racer = np.where(mask, racer[np.where(h >= 0, h, 0)], -999)
    tgt_racer = racer[sample][:, None]
    assert not np.any(mask & (tok_racer != tgt_racer)), "❌ 別選手のトークンが混入"
    unknown = racer < 0
    assert (store.hist[unknown] < 0).all(), "❌ racer_id不明行に履歴が付いている"
    print(
        f"✅ 同一選手検証OK（racer_id不明 {unknown.sum():,}行は履歴なしに分離）"
    )

    depth = mask.sum(axis=1)
    print(
        f"📏 履歴深度: 平均{depth.mean():.1f} / 中央値{np.median(depth):.0f} / "
        f"満杯({MAX_LEN})率 {(depth == MAX_LEN).mean():.1%} / ゼロ率 {(depth == 0).mean():.2%}"
    )


if __name__ == "__main__":
    _self_test()
