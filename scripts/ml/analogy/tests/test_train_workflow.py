"""週次の学習ワークフロー（train-analogy.yml）の順序と、長期分のキャッシュの版（T10-4）"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WF = (ROOT / ".github/workflows/train-analogy.yml").read_text()


def test_parity_check_runs_before_upload_and_activate():
    """一致しない版を Storage に置かず、切り替えもしない（ADR 案（#1134）決定6）"""
    parity = WF.index("node scripts/ml/analogy/treeshap-parity.js data/ml/analogy/out/")
    assert WF.index("python train.py") < parity
    assert parity < WF.index("storage.js upload-model")
    assert parity < WF.index("python db.py write")


def test_kb_cache_version_is_after_boa696():
    """v1 は BOA-696 の前の長期分（最終日が全件 false）。features.check_final_day が拒否する"""
    src = (ROOT / "scripts/ml/analogy/export_pool.js").read_text()
    v = re.search(r'const KB_CACHE_VERSION = "v(\d+)"', src)
    assert v and int(v.group(1)) >= 2


def _if(step: str) -> str:
    block = WF[WF.index(f"- name: {step}"):]
    return block.split("\n")[1].strip()


def test_write_only_skips_training_and_downloads_before_write():
    """書き込みの段で失敗した版を、学習をやり直さずに書き直せる（profiles.json を書き込みの前に Storage に置く）"""
    for step in ("Export training data", "Build features", "Contribution profiles", "Upload profiles to Storage"):
        assert _if(step) == "if: inputs.write_only_version == ''", step
    for step in ("Train and quality gate", "Upload model to Storage", "Parity check (treeshap-parity.js)"):
        assert "inputs.write_only_version == ''" in _if(step), step
    assert WF.index("storage.js upload-profiles") < WF.index("python db.py write")
    assert WF.index("storage.js download-trained ") < WF.index("python db.py write")


def test_profiles_run_after_models_are_in_storage():
    """profiles の計算で失敗しても学習をやり直さずに済む: モデル（seed ごと）を先に Storage に置き、
    profiles_only_version で profiles だけ作り直せる（run 37304986570 は profiles の書き出しで失敗し、2.5時間が無駄になった）"""
    assert WF.index("python train.py --train-only") < WF.index("storage.js upload-model") \
        < WF.index("python train.py --profiles-only")
    for step in ("Download reference model (品質ゲートの比較用)", "Train and quality gate",
                 "Parity check (treeshap-parity.js)", "Upload model to Storage"):
        assert "inputs.profiles_only_version == ''" in _if(step), step
    assert _if("Download trained models (profiles_only_version)") == "if: inputs.profiles_only_version != ''"
    assert WF.index("storage.js download-trained-models") < WF.index("python train.py --profiles-only")
    src = (ROOT / "scripts/ml/analogy/storage.js").read_text()
    assert "meta.seed_model_files" in src


def test_seed_model_file_names_match_between_phases():
    import train as T
    assert T.seed_model_file("win", T.SEEDS[0]) == "model_win.txt"
    if len(T.SEEDS) > 1:
        assert T.seed_model_file("top2_racecard", T.SEEDS[1]) == f"model_top2_racecard_seed{T.SEEDS[1]}.txt"
    src = (ROOT / "scripts/ml/analogy/train.py").read_text()
    # profiles の段は train_meta の seeds から同じ名前を組み立てる
    assert 'f"model_{name}_seed{seed}.txt"' in src
