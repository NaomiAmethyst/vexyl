#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>
"""Downloads country and pride flag SVGs from Wikimedia, with their license data.

    fetch_flags.py DIR

Files are written under DIR, along with index.json. Treat them as untrusted data.
"""
import json,os,re,sys,time,urllib.parse,urllib.request
C=sys.argv[1]
os.makedirs(C,exist_ok=True)
UA='vexyl-flag-importer/0.1 (https://github.com/NaomiAmethyst/vexyl)'
def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=60) as r: return r.read()
        except Exception as e:
            if attempt==4: raise
            time.sleep(4*(attempt+1))
def api(host,**p):
    p.update(action='query',format='json'); out=[]; cont={}
    while True:
        d=json.loads(get(f'https://{host}/w/api.php?'+urllib.parse.urlencode({**p,**cont})))
        out.extend(d.get('query',{}).get('pages',{}).values())
        if 'continue' not in d: return out
        cont=d['continue']; time.sleep(.3)
info=dict(prop='imageinfo',iiprop='url|size|mime|extmetadata',iiextmetadatafilter='LicenseShortName|Artist|Credit|ObjectName|ImageDescription',gimlimit='max')
def images(title): return api('en.wikipedia.org',titles=title,generator='images',**info)
def cat(name): return api('commons.wikimedia.org',generator='categorymembers',gcmtitle='Category:'+name,gcmtype='file',gcmlimit='max',prop=info['prop'],iiprop=info['iiprop'],iiextmetadatafilter=info['iiextmetadatafilter'])
sets={'country':images('List of national flags of sovereign states'),'pride':[]}
for t in ('Pride flag','LGBTQ symbols'): sets['pride']+=images(t)
for c in ('SVG LGBT flags','SVG flags of LGBT','LGBT flags','Pride flags','Rainbow flags (LGBT)'):
    try:
        m=cat(c); print('category',c,len(m)); sets['pride']+=m
    except Exception as e: print('category failed',c,e)
index={}
for kind,pages in sets.items():
    for v in pages:
        if not v.get('imageinfo'): continue
        ii=v['imageinfo'][0]; t=v['title']
        if ii['mime']!='image/svg+xml' or ii['size']>2_000_000: continue
        low=t.lower()
        if kind=='country' and not low.startswith('file:flag of'): continue
        if kind=='pride' and 'flag' not in low and 'pride' not in low: continue
        name=re.sub(r'[^a-z0-9]+','-',re.sub(r'^file:|\.svg$','',low)).strip('-')
        name=re.sub(r'^flag-of-(the-)?','',name) if kind=='country' else name
        index.setdefault(f'{kind}/{name}',dict(kind=kind,title=t,url=ii['url'],size=ii['size'],page=ii.get('descriptionurl'),meta={k:x.get('value') for k,x in ii.get('extmetadata',{}).items()}))
print('selected',{k:sum(1 for x in index if x.startswith(k)) for k in sets})
json.dump(index,open(C+'/index.json','w'),indent=1)
os.makedirs(C+'/svg/country',exist_ok=True); os.makedirs(C+'/svg/pride',exist_ok=True)
n=0
for key,e in index.items():
    p=f'{C}/svg/{key}.svg'
    if os.path.exists(p): continue
    try:
        open(p,'wb').write(get(e['url'])); n+=1
    except Exception as ex: print('FAIL',key,ex)
    time.sleep(.25)
print('downloaded',n)
