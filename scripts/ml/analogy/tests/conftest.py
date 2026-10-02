import sys
from pathlib import Path

# scripts/ml/analogy をモジュール検索パスに入れる（train.py 等と同じく、ディレクトリ内で import する）
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
