# 共通: パス・会場名・項目名・Wilson 区間・順位区分
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
OUT_DIR = os.path.join(ROOT, 'data/analysis/original-exhibition')
# 中間データ（raw.json・boats.pkl・boats_f.pkl）の置き場。gitignore 対象
WORK = os.environ.get('OX_WORK_DIR', os.path.join(OUT_DIR, 'work'))

VEN = {1:'桐生',2:'戸田',3:'江戸川',4:'平和島',5:'多摩川',6:'浜名湖',7:'蒲郡',8:'常滑',9:'津',10:'三国',11:'びわこ',12:'住之江',
       13:'尼崎',14:'鳴門',15:'丸亀',16:'児島',17:'宮島',18:'徳山',19:'下関',20:'若松',21:'芦屋',22:'福岡',23:'唐津',24:'大村'}
ITEMS = ['lap', 'mawari', 'straight']
JA = {'lap':'周回(一周/半周)', 'mawari':'まわり足', 'straight':'直線', 'exhibition_time':'展示タイム'}


def wil(k, n, z=1.96):
  """Wilson 95% 区間 (p, 下限, 上限)"""
  if n == 0: return (np.nan, np.nan, np.nan)
  p = k/n; dd = 1+z*z/n; c = (p+z*z/(2*n))/dd; h = z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/dd
  return p, c-h, c+h


def fmt(k, n):
  p, l, u = wil(k, n); return f"{p:.3f} [{l:.3f}–{u:.3f}] {k}/{n}"


def grp(r):
  """順位 → 上位1-2 / 中位3-4 / 下位5-6"""
  return np.where(r <= 2, '上位1-2', np.where(r <= 4, '中位3-4', '下位5-6'))
