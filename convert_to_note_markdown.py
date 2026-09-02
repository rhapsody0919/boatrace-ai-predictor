#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マークダウンをnote用のMarkdown形式に最適化するスクリプト
noteがサポートしている記法のみを使用します
"""

import re
import sys

def optimize_for_note(md_text):
    """note用にMarkdownを最適化"""
    lines = md_text.split('\n')
    output = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # 空行はそのまま
        if not line.strip():
            output.append('')
            i += 1
            continue
        
        # 見出し（noteがサポートしている形式）
        if line.startswith('#### '):
            text = line[5:].strip()
            # 見出しの前に空行を追加（最初の行でない場合）
            if output and output[-1].strip():
                output.append('')
            output.append(f'#### {text}')
            output.append('')  # 見出しの後に空行
            i += 1
            continue
        elif line.startswith('### '):
            text = line[4:].strip()
            if output and output[-1].strip():
                output.append('')
            output.append(f'### {text}')
            output.append('')
            i += 1
            continue
        elif line.startswith('## '):
            text = line[3:].strip()
            if output and output[-1].strip():
                output.append('')
            output.append(f'## {text}')
            output.append('')
            i += 1
            continue
        elif line.startswith('# '):
            text = line[2:].strip()
            if output and output[-1].strip():
                output.append('')
            output.append(f'# {text}')
            output.append('')
            i += 1
            continue
        
        # 水平線
        if line.strip() == '---':
            output.append('')
            output.append('---')
            output.append('')
            i += 1
            continue
        
        # リスト（noteがサポートしている形式）
        if line.startswith('- '):
            text = line[2:].strip()
            # リストの前に空行を追加（前の行がリストでない場合）
            if output and output[-1].strip() and not output[-1].startswith('- '):
                output.append('')
            output.append(f'- {text}')
            i += 1
            continue
        
        # 順序付きリスト
        ordered_match = re.match(r'^(\d+)\.\s+(.+)$', line)
        if ordered_match:
            num = ordered_match.group(1)
            text = ordered_match.group(2)
            # リストの前に空行を追加
            if output and output[-1].strip() and not re.match(r'^\d+\.', output[-1]):
                output.append('')
            output.append(f'{num}. {text}')
            i += 1
            continue
        
        # テーブル（noteは表記法非対応のため箇条書きに変換する。
        # 以前はテーブル行を無条件でスキップしており、変換されずに表の
        # 内容ごと本文から消えるバグがあった。2026-09-02、
        # boat-number-technique-consistency記事のnote下書き作成時に発覚）
        if (
            line.strip().startswith('|')
            and '---' not in line
            and i + 1 < len(lines)
            and re.match(r'^\s*\|[\s:|-]+\|\s*$', lines[i + 1])
        ):
            header_cells = [c.strip() for c in line.strip().strip('|').split('|')]
            j = i + 2  # ヘッダー行・区切り行の次からデータ行
            data_rows = []
            while j < len(lines) and lines[j].strip().startswith('|'):
                data_rows.append(
                    [c.strip() for c in lines[j].strip().strip('|').split('|')]
                )
                j += 1

            if output and output[-1].strip():
                output.append('')
            output.append(f"**{' / '.join(header_cells)}**")
            output.append('')
            for row in data_rows:
                output.append(f"- {' / '.join(row)}")
            output.append('')
            i = j
            continue

        # 通常のテキスト（Markdown記法はそのまま）
        # リンクをnote形式に変換 [text](url) → [text](url)（そのまま）
        output.append(line)
        i += 1
    
    # 連続する空行を2つまでに制限
    result = []
    prev_empty = False
    for line in output:
        if not line.strip():
            if not prev_empty:
                result.append('')
                prev_empty = True
        else:
            result.append(line)
            prev_empty = False
    
    return '\n'.join(result)

def main():
    if len(sys.argv) < 2:
        print("使用方法: python convert_to_note_markdown.py <markdown_file>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            md_content = f.read()
        
        note_content = optimize_for_note(md_content)
        
        # 出力ファイル名を生成
        output_file = input_file.replace('.md', '_note.md')
        
        with open(output_file, 'w', encoding='utf-8', newline='\n') as f:
            f.write(note_content)
        
        print(f"変換完了: {output_file}")
        print("\n--- note用Markdown（最初の500文字）---")
        print(note_content[:500])
        print("\n\nこのファイルをnoteエディタに貼り付けてください。")
        print("noteは以下のMarkdown記法をサポートしています：")
        print("- 見出し（#, ##, ###, ####）")
        print("- リスト（-, 1.）")
        print("- 太字（**text**）")
        print("- リンク（[text](url)）")
        
    except FileNotFoundError:
        print(f"エラー: ファイル '{input_file}' が見つかりません")
        sys.exit(1)
    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()


