import json,re,hashlib
P="/Users/terukina/.claude/projects/-Users-terukina-boatrace-ai-predictor--claude-worktrees-confident-chatelet-c22064/42ade70b-827e-48f3-b33a-05c6914c677c/tool-results/mcp-supabase-execute_sql-"
for f in ['1791095885382','1791095893808','1791095903953']:
    t=open(P+f+'.txt').read()
    m=re.search(r'\[\{(?:\\)*"tag(?:\\)*":.*?\}\]', t); s=m.group(0)
    while True:
        try: arr=json.loads(s); break
        except Exception: s=s.encode().decode('unicode_escape')
    if isinstance(arr,str): arr=json.loads(arr)
    d=arr[0]; ok=hashlib.md5(d['s'].encode()).hexdigest()==d['md5']; n=len(d['s'].split(','))
    print(d['tag'],d['n'],n,ok)
    if ok and n==d['n']: open(f"raw/{d['tag']}.txt","w").write(d['s'])
