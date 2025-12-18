#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マークダウンをnote用のプレーンテキスト形式に変換するスクリプト
noteエディタで手動で書式を適用できる形式にします
"""

import re
import sys

def markdown_to_note_plaintext(md_text):
    """マークダウンをnote用のプレーンテキストに変換"""
    lines = md_text.split('\n')
    output = []
    
    for line in lines:
        # 空行はそのまま
        if not line.strip():
            output.append('')
            continue
        
        # 見出しをプレーンテキストに（#を削除）
        if line.startswith('#### '):
            text = line[5:].strip()
            text = remove_markdown_formatting(text)
            output.append(text)
            output.append('')  # 見出しの後に空行
            continue
        elif line.startswith('### '):
            text = line[4:].strip()
            text = remove_markdown_formatting(text)
            output.append(text)
            output.append('')  # 見出しの後に空行
            continue
        elif line.startswith('## '):
            text = line[3:].strip()
            text = remove_markdown_formatting(text)
            output.append(text)
            output.append('')  # 見出しの後に空行
            continue
        elif line.startswith('# '):
            text = line[2:].strip()
            text = remove_markdown_formatting(text)
            output.append(text)
            output.append('')  # 見出しの後に空行
            continue
        
        # 水平線は空行に
        if line.strip() == '---':
            output.append('')
            output.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            output.append('')
            continue
        
        # リストをプレーンテキストに（-を削除、代わりに・を使用）
        if line.startswith('- '):
            text = line[2:].strip()
            text = remove_markdown_formatting(text)
            output.append(f'・{text}')
            continue
        
        # 順序付きリストをプレーンテキストに
        ordered_match = re.match(r'^(\d+)\.\s+(.+)$', line)
        if ordered_match:
            num = ordered_match.group(1)
            text = ordered_match.group(2)
            text = remove_markdown_formatting(text)
            output.append(f'{num}. {text}')
            continue
        
        # テーブル行をスキップ（既に箇条書きに変換済み）
        if line.strip().startswith('|') and '---' not in line:
            # テーブル行はスキップ（既に箇条書き形式に変換済み）
            continue
        
        # テーブルの区切り線をスキップ
        if '|---' in line or '|------' in line:
            continue
        
        # 通常のテキスト（Markdown記法を削除）
        text = remove_markdown_formatting(line)
        output.append(text)
    
    return '\n'.join(output)

def remove_markdown_formatting(text):
    """Markdown記法を削除してプレーンテキストに"""
    # リンク [text](url) → text (url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', text)
    
    # 太字 **text** → text（太字は残すが、**は削除）
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    
    # インラインコード `code` → code
    text = re.sub(r'`([^`]+)`', r'\1', text)
    
    return text

def main():
    if len(sys.argv) < 2:
        print("使用方法: python convert_to_note_format.py <markdown_file>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            md_content = f.read()
        
        note_content = markdown_to_note_plaintext(md_content)
        
        # 出力ファイル名を生成
        output_file = input_file.replace('.md', '_note.txt')
        
        with open(output_file, 'w', encoding='utf-8', newline='\n') as f:
            f.write(note_content)
        
        print(f"変換完了: {output_file}")
        print("\n--- note用テキスト（最初の500文字）---")
        print(note_content[:500])
        print("\n\nこのファイルをnoteエディタに貼り付けて、手動で書式を適用してください。")
        print("見出しは選択して「見出し」ボタンを、リストは「箇条書き」ボタンを使用してください。")
        
    except FileNotFoundError:
        print(f"エラー: ファイル '{input_file}' が見つかりません")
        sys.exit(1)
    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()


