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
