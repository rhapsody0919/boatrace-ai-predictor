#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マークダウンファイルを正規化するスクリプト
- タブ文字をスペースに変換
- 改行文字をLFに統一
- 行末の空白を削除
"""

import sys
import re

def normalize_markdown(input_file, output_file=None):
    """マークダウンファイルを正規化"""
    if output_file is None:
        output_file = input_file
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # タブをスペースに変換（4スペース）
        content = content.replace('\t', '    ')
        
        # 改行文字をLFに統一
        content = content.replace('\r\n', '\n').replace('\r', '\n')
        
        # 行末の空白を削除
        lines = content.split('\n')
        normalized_lines = [line.rstrip() for line in lines]
        content = '\n'.join(normalized_lines)
        
        # 連続する空行を2つまでに制限
        content = re.sub(r'\n{3,}', '\n\n', content)
        
        with open(output_file, 'w', encoding='utf-8', newline='\n') as f:
            f.write(content)
        
        print(f"正規化完了: {output_file}")
        print(f"  - タブ文字をスペースに変換")
        print(f"  - 改行文字をLFに統一")
        print(f"  - 行末の空白を削除")
        
    except FileNotFoundError:
        print(f"エラー: ファイル '{input_file}' が見つかりません")
        sys.exit(1)
    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("使用方法: python normalize_markdown.py <markdown_file>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    normalize_markdown(input_file)

