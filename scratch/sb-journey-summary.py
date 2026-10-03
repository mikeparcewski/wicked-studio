import json,re,sys
t=open(sys.argv[1]).read()
m=re.search(r'\{\s*"ok".*\}\s*(?=exit=)', t, re.S)
if not m:
    print(t[-1800:]); sys.exit(0)
d=json.loads(m.group(0))
print('ok=',d['ok'],'part=',d.get('part'))
for k,v in d['steps'].items():
    print(' ',k, v['ok'])
    if not v['ok']: print(json.dumps(v, indent=1)[:int(sys.argv[2]) if len(sys.argv)>2 else 2200].replace('127.0.0.1','LOCAL'))
print(t[t.rfind('exit='):].strip())
