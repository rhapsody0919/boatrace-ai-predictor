#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マークダウンファイルをHTML形式に変換するスクリプト
note用のHTMLを生成します
"""

import re
import sys

def markdown_to_html(md_text):
    """マークダウンをHTMLに変換"""
    html = []
    lines = md_text.split('\n')
    in_list = False
    in_ordered_list = False
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # 空行
        if not line.strip():
            if in_list:
                html.append('</ul>')
                in_list = False
            if in_ordered_list:
                html.append('</ol>')
                in_ordered_list = False
            html.append('<br>')
            i += 1
            continue
        
        # 見出し
        if line.startswith('#### '):
            text = line[5:].strip()
            text = process_inline_formatting(text)
            html.append(f'<h4>{text}</h4>')
            i += 1
            continue
        elif line.startswith('### '):
            text = line[4:].strip()
            text = process_inline_formatting(text)
            html.append(f'<h3>{text}</h3>')
            i += 1
            continue
        elif line.startswith('## '):
            text = line[3:].strip()
            text = process_inline_formatting(text)
            html.append(f'<h2>{text}</h2>')
            i += 1
            continue
        elif line.startswith('# '):
            text = line[2:].strip()
            text = process_inline_formatting(text)
            html.append(f'<h1>{text}</h1>')
            i += 1
            continue
        
        # 水平線
        if line.strip() == '---':
            html.append('<hr>')
            i += 1
            continue
        
        # 順序付きリスト
        ordered_match = re.match(r'^(\d+)\.\s+(.+)$', line)
        if ordered_match:
            if not in_ordered_list:
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append('<ol>')
                in_ordered_list = True
            text = ordered_match.group(2)
            text = process_inline_formatting(text)
            html.append(f'<li>{text}</li>')
            i += 1
            continue
        
        # 箇条書きリスト
        if line.startswith('- '):
            if not in_list:
                if in_ordered_list:
                    html.append('</ol>')
                    in_ordered_list = False
                html.append('<ul>')
                in_list = True
            text = line[2:].strip()
            text = process_inline_formatting(text)
            html.append(f'<li>{text}</li>')
            i += 1
            continue
        
        # テーブル処理（複数行を一度に処理）
        if line.strip().startswith('|'):
            # テーブル開始
            if in_list:
                html.append('</ul>')
                in_list = False
            if in_ordered_list:
                html.append('</ol>')
                in_ordered_list = False
            
            html.append('<table border="1" style="border-collapse: collapse; width: 100%; margin: 10px 0;">')
            html.append('<tbody>')
            
            # ヘッダー行
            cells = [cell.strip() for cell in line.split('|')[1:-1]]
            if cells:
                html.append('<tr>')
                for cell in cells:
                    cell_html = process_inline_formatting(cell)
                    html.append(f'<th style="padding: 8px; background-color: #f0f0f0;">{cell_html}</th>')
                html.append('</tr>')
            
            # 区切り線をスキップ
            i += 1
            if i < len(lines) and ('|---' in lines[i] or '|------' in lines[i]):
                i += 1
            
            # データ行を処理
            while i < len(lines) and lines[i].strip().startswith('|') and '---' not in lines[i]:
                data_line = lines[i]
                cells = [cell.strip() for cell in data_line.split('|')[1:-1]]
                if cells:
                    html.append('<tr>')
                    for cell in cells:
                        cell_html = process_inline_formatting(cell)
                        html.append(f'<td style="padding: 8px;">{cell_html}</td>')
                    html.append('</tr>')
                i += 1
            
            html.append('</tbody>')
            html.append('</table>')
            continue
        
        # 通常の段落
        if in_list:
            html.append('</ul>')
            in_list = False
        if in_ordered_list:
            html.append('</ol>')
            in_ordered_list = False
        
        text = process_inline_formatting(line)
        html.append(f'<p>{text}</p>')
        i += 1
    
    # リストを閉じる
    if in_list:
        html.append('</ul>')
    if in_ordered_list:
        html.append('</ol>')
    
    return '\n'.join(html)

def process_inline_formatting(text):
    """インライン形式を処理（太字、リンクなど）"""
    # リンク [text](url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    
    # URLをリンクに変換（https:// または http:// で始まる）
    text = re.sub(r'(https?://[^\s]+)', r'<a href="\1">\1</a>', text)
    
    # 太字 **text**
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    
    # インラインコード `code`
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    
    return text

def main():
    if len(sys.argv) < 2:
        print("使用方法: python convert_md_to_html.py <markdown_file>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            md_content = f.read()
        
        html_content = markdown_to_html(md_content)
        
        # 出力ファイル名を生成
        output_file = input_file.replace('.md', '.html')
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"変換完了: {output_file}")
        print("\n--- HTML出力 ---")
        print(html_content)
        
    except FileNotFoundError:
        print(f"エラー: ファイル '{input_file}' が見つかりません")
        sys.exit(1)
    except Exception as e:
        print(f"エラー: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()

