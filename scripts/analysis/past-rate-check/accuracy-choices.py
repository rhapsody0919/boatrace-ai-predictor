import json, itertools
forms=["flat","wall","d2","d3","kado","d1","dash"]
C=[]
for o in [(1,[2],[3]),(2,[1],[3]),(4,[1],[2]),(1,[2,3],[2,3,4]),(1,[2,3,4,5,6],[2,3,4,5,6]),(3,[1,4],[1,2,4,5])]:
    C.append(("order",{"first":o[0],"second":o[1],"third":o[2],"nagashi":len(o[1])>1 or len(o[2])>1}))
for x in ["win","top3","out"]: C.append(("boat1",{"outcome":x}))
for b,t in [(1,"nige"),(2,"sashi"),(3,"makuri"),(4,"makuri"),(4,"makurizashi"),(5,"makurizashi"),(2,"makuri")]:
    C.append(("tenkai",{"boat":b,"technique":t}))
for lv in [1,2]:
    for f in forms: C.append(("slit",{"mode":"forms","patterns":[f],"level":lv}))
    for a,b in [("d3","kado"),("flat","dash"),("kado","dash"),("wall","kado"),("d1","dash"),("flat","wall"),("d2","kado")]:
        C.append(("slit",{"mode":"forms","patterns":[a,b],"level":lv}))
for cs in [[-1,0,0,1,0,0],[0,0,0,1,0,0],[1,0,0,0,0,0],[0,-1,1,0,0,0],[0,0,0,0,0,1]]:
    C.append(("slit",{"mode":"custom","courses":cs}))
for b in [3,4,5,6]:
    for t in ["within3","within4","waku"]: C.append(("entry",{"boat":b,"target":t}))
for x in ["low","mid","high"]: C.append(("payout",{"band":x}))
json.dump([{"type":t,"input":i} for t,i in C],open(__file__.replace("choices.py","choices.json"),"w"))
print(len(C))
