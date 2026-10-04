import io
t=io.open('template16.html',encoding='utf-8').read();d=io.open('data.js',encoding='utf-8').read();s=io.open('scn.js',encoding='utf-8').read()+'D.tab1='+io.open('../tab1/tab1.json',encoding='utf-8').read()+';\n'+'D.mark1='+io.open('../slitpred/mark1.json',encoding='utf-8').read()+';\n'+(('D.hint='+io.open('../slitpred/slitpred2_hint.json',encoding='utf-8').read()+';\n') if __import__('os').path.exists('../slitpred/slitpred2_hint.json') else '')
assert t.count('/*DATA*/')==1
io.open('analogy-finder-v16.html','w',encoding='utf-8').write(t.replace('/*DATA*/',d+s))
