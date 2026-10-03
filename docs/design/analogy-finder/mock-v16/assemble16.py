import io
t=io.open('template16.html',encoding='utf-8').read();d=io.open('data.js',encoding='utf-8').read();s=io.open('scn.js',encoding='utf-8').read()+'D.tab1='+io.open('../tab1/tab1.json',encoding='utf-8').read()+';\n'
assert t.count('/*DATA*/')==1
io.open('analogy-finder-v16.html','w',encoding='utf-8').write(t.replace('/*DATA*/',d+s))
