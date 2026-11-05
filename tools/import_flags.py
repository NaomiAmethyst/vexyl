#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Imports a downloaded corpus of flags and checks each result against its source.

    import_flags.py CORPUS OUT VEXYL [EXPORT]

Every flag is converted by svg2vexyl.py and validated and rendered by VEXYL, then its
source and result are rendered in Chrome and compared pixel by pixel. If EXPORT is
given, flags that match and have a known license are written there, with a report.
"""
import base64,collections,html,json,os,re,subprocess,sys,time
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
C,OUT,VX=sys.argv[1:4]
EXPORT=sys.argv[4] if len(sys.argv)>4 else None
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import svg2vexyl as S
import xml.etree.ElementTree as ET
index=json.load(open(C+'/index.json'))
os.makedirs(OUT+'/kdl/country',exist_ok=True);os.makedirs(OUT+'/kdl/pride',exist_ok=True);os.makedirs(OUT+'/svg/country',exist_ok=True);os.makedirs(OUT+'/svg/pride',exist_ok=True)
LIC={'cc0':'CC0-1.0','cc by-sa 4.0':'CC-BY-SA-4.0','cc by-sa 3.0':'CC-BY-SA-3.0','cc by 4.0':'CC-BY-4.0','cc by 3.0':'CC-BY-3.0'}
def lic(s):
    s=(s or '').strip().lower()
    if s in LIC: return LIC[s]
    if s.startswith('public domain') or s.startswith('pd'): return 'LicenseRef-Public-Domain'
    if s.startswith('copyrighted free use'): return 'LicenseRef-Copyrighted-Free-Use'
    return None
def strip(s):
    text=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>','',s or ''))).strip()[:120]
    # Commons' placeholders aren't anyone's name.
    if re.search(r'file history|unknown author',text,re.I): return None
    return text or None
res={}
for key,e in sorted(index.items()):
    src=open(f'{C}/svg/{key}.svg','rb').read()
    title=re.sub(r'^File:|\.svg$','',e['title'])
    r=res[key]=dict(status=None,reason=None,native=0,inline=0,size=len(src),license=e['meta'].get('LicenseShortName'))
    try:
        text,stats=S.convert(src,title,e.get('page'),strip(e['meta'].get('Artist')),lic(e['meta'].get('LicenseShortName')))
    except S.Unsupported as x:
        r.update(status='unsupported',reason=str(x));continue
    except ET.ParseError as x:
        r.update(status='unsupported',reason='xml: '+str(x)[:30]);continue
    except Exception as x:
        r.update(status='crash',reason=f'{type(x).__name__}: {x}'[:70]);continue
    r['reasons']=stats.pop('reasons'); r.update(stats); r['kdlsize']=len(text)
    open(f'{OUT}/kdl/{key}.kdl','w').write(text)
    p=subprocess.run([VX,'render','-o',f'{OUT}/svg/{key}.svg',f'{OUT}/kdl/{key}.kdl'],capture_output=True,text=True)
    if p.returncode:
        msg=p.stderr.strip().split('\n')[0]
        msg=re.sub(r'^\S+:\d+:\d+:\s*','',msg)
        r.update(status='rejected',reason=msg[:90]);continue
    r['status']='rendered'
# --- batch diff: same grid of cells rendered from sources and from imports
def size_of(s):
    s=s.decode('utf8','ignore')
    head=re.search(r'<svg\b[^>]*>',s,re.S)
    h=head.group(0) if head else ''
    m=re.search(r'viewBox\s*=\s*["\']([^"\']+)',h)
    if m:
        v=[float(x) for x in re.split(r'[\s,]+',m.group(1).strip())];return v[2],v[3]
    num=r'["\']\s*([-+\d.eE]+)'
    mw,mh=re.search(r'\bwidth\s*=\s*'+num,h),re.search(r'\bheight\s*=\s*'+num,h)
    return float(mw.group(1)),float(mh.group(1))
def normalized(b):
    s=b.decode('utf8','ignore')
    w,h=size_of(b)
    def fix(m):
        t=m.group(0)
        t=re.sub(r'\s(?:width|height)\s*=\s*(["\'])[^"\']*\1','',t)
        t=re.sub(r'\spreserveAspectRatio\s*=\s*(["\'])[^"\']*\1','',t)
        if not re.search(r'viewBox\s*=',t): t=t.replace('<svg',f'<svg viewBox="0 0 {w} {h}"',1)
        return t.replace('<svg','<svg preserveAspectRatio="none"',1)
    return re.sub(r'<svg\b[^>]*>',fix,s,count=1,flags=re.S)
keys=[k for k,r in res.items() if r['status']=='rendered']
CW,COLS=420,5
cells=[];y=0;x=0;rowh=0
for k in keys:
    w,h=size_of(open(f'{C}/svg/{k}.svg','rb').read())
    ch=round(CW*h/w)
    if ch>420: ch=420
    if x+CW>COLS*(CW+10):
        x=0;y+=rowh+10;rowh=0
    cells.append((k,x,y,CW,ch));x+=CW+10;rowh=max(rowh,ch)
total=y+rowh+10
def shoot(which,path):
    parts=[]
    for k,x,y,w,h in cells:
        b=open(f'{C}/svg/{k}.svg' if which=='src' else f'{OUT}/svg/{k}.svg','rb').read()
        d=base64.b64encode(normalized(b).encode()).decode()
        parts.append(f'<img style="position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px" src="data:image/svg+xml;base64,{d}">')
    f=f'{OUT}/{which}.html';open(f,'w').write('<!doctype html><body style="margin:0;background:#0f0">'+''.join(parts))
    subprocess.run(['google-chrome','--headless','--no-sandbox','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1','--virtual-time-budget=20000',f'--user-data-dir={OUT}/chrome',f'--window-size={COLS*(CW+10)},{total}',f'--screenshot={path}','file://'+f],capture_output=True,timeout=300)
shoot('src',OUT+'/src.png');shoot('imp',OUT+'/imp.png')
A=np.asarray(Image.open(OUT+'/src.png').convert('RGB')).astype(int);B=np.asarray(Image.open(OUT+'/imp.png').convert('RGB')).astype(int)
for k,x,y,w,h in cells:
    a,b=A[y:y+h,x:x+w],B[y:y+h,x:x+w]
    d=np.abs(a-b).sum(2)>48
    e=d.copy()
    e=e[1:-1,1:-1]&e[:-2,1:-1]&e[2:,1:-1]&e[1:-1,:-2]&e[1:-1,2:]
    res[k].update(diff=round(float(d.mean()*100),3),thick=round(float(e.mean()*100),3),cell=[x,y,w,h])
    res[k]['status']='match' if res[k]['thick']<0.05 else ('close' if res[k]['thick']<0.5 else 'mismatch')
json.dump(res,open(OUT+'/results.json','w'),indent=1)
# --- report
for kind in ('country','pride'):
    rs={k:v for k,v in res.items() if k.startswith(kind)}
    n=len(rs);st=collections.Counter(v['status'] for v in rs.values())
    nat=sum(1 for v in rs.values() if v['status'] in('match','close') and v['native']>0 and v['inline']==0)
    hyb=sum(1 for v in rs.values() if v['status'] in('match','close') and v['native']>0 and v['inline']>0)
    inl=sum(1 for v in rs.values() if v['status'] in('match','close') and v['native']==0)
    print(f'{kind}: {n} total, {dict(st)} | good: fully native {nat}, part native {hyb}, all inline {inl}')
print('failure reasons:',collections.Counter(v['reason'] for v in res.values() if v['reason']).most_common(25))
print('mismatches:',sorted((v['thick'],k) for k,v in res.items() if v['status']=='mismatch')[::-1][:30])
print('close:',sorted((v['thick'],k) for k,v in res.items() if v['status']=='close')[::-1][:20])
print('unsupported/rejected:',[(k,v['reason'][:40]) for k,v in res.items() if v['status'] in('unsupported','rejected','crash')][:40])
print('inline reasons (shapes):',collections.Counter(x for v in res.values() if v['status'] in('match','close') for x in v.get('reasons',[])).most_common(15))
print('inline reasons (flags):',collections.Counter(x for v in res.values() if v['status'] in('match','close') for x in set(v.get('reasons',[]))).most_common(15))
print('largest kdl:',sorted(((v.get('kdlsize',0),k) for k,v in res.items()),reverse=True)[:6])
# --- export what's known to be shareable
if EXPORT:
    import shutil
    excluded=[]
    rows=['flag\tnative shapes\tinline artwork\tdifference %\tlicense']
    for k,v in sorted(res.items()):
        id_=lic(v.get('license'))
        # The Progress design has its own terms, covered by flags/progress-pride.kdl.
        if v['status']!='match' or id_ is None or 'quasar' in k:
            excluded.append(k);continue
        os.makedirs(os.path.dirname(f'{EXPORT}/{k}.kdl'),exist_ok=True)
        shutil.copy(f'{OUT}/kdl/{k}.kdl',f'{EXPORT}/{k}.kdl')
        rows.append(f"{k}\t{v['native']}\t{v['inline']}\t{v['diff']}\t{id_}")
    open(f'{EXPORT}/report.tsv','w').write('\n'.join(rows)+'\n')
    print('exported',len(rows)-1,'excluded',excluded)
