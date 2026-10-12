from pathlib import Path
import json
import xml.etree.ElementTree as ET

OUT = Path(__file__).parent
INK = '#18221f'

# Original geometric lettering: every exported logo is paths, not live fonts.
LETTERS = {
    'f': ('M43 13 C26 8 22 19 22 33 V80 M8 36 H43', 53),
    'e': ('M12 52 H48 C48 20 10 20 10 52 C10 80 36 87 49 70', 59),
    'd': ('M48 12 V80 M48 52 C48 20 10 20 10 52 C10 85 48 85 48 52', 60),
    'u': ('M10 34 V60 C10 89 47 89 47 60 V34', 59),
    'n': ('M10 80 V34 M10 54 C10 26 47 26 47 54 V80', 59),
}

def word(text, eyes=False):
    parts, x = [], 0
    for c in text:
        if c == '.':
            parts.append(f'<circle cx="{x+7}" cy="78" r="6" fill="currentColor"/>')
            x += 25
        else:
            d, w = LETTERS[c]
            parts.append(f'<path transform="translate({x} 0)" d="{d}"/>')
            if eyes and c == 'e':
                parts.append(f'<circle cx="{x+31}" cy="40" r="4.2" fill="currentColor" stroke="none"/>')
            x += w
    return '<g fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round">'+''.join(parts)+'</g>', x

CONCEPTS = [
    dict(id='01-peep', name='Peep', tag='A little presence.', category='AGENT / CHAT', color='#d8f36a',
         desc='Two eyes and a speech tail. Friendly, aware, ready to reply.',
         icon='<path d="M27 17 H73 Q90 17 90 34 V64 Q90 80 73 80 H43 L23 93 V79 Q10 76 10 63 V34 Q10 17 27 17Z" fill="currentColor"/><path d="M37 42 V55 M63 42 V55" stroke="var(--cutout, white)" stroke-width="10" stroke-linecap="round"/>'),
    dict(id='02-loop', name='Loop', tag='An f with momentum.', category='ABSTRACT / LETTERMARK', color='#cbbcff',
         desc='A continuous ribbon f. Signals circulating through a network.',
         icon='<path d="M33 88 V30 C33 10 75 9 75 29 C75 46 53 49 20 49 H77 M33 70 H63" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>'),
    dict(id='03-finch', name='Finch', tag='Something worth chirping.', category='ANIMAL / BIRD', color='#ffb68a',
         desc='A round little bird with a sharp beak. Social and curious.',
         icon='<path d="M15 29 L32 39 C42 13 77 17 81 41 L96 49 L81 57 C76 84 42 91 24 70 C14 57 14 42 15 29Z" fill="currentColor"/><circle cx="65" cy="40" r="5" fill="var(--cutout, white)"/><path d="M35 53 Q44 67 58 58" fill="none" stroke="var(--cutout, white)" stroke-width="6" stroke-linecap="round"/>'),
    dict(id='04-fox', name='Fox', tag='A clever kind of social.', category='ANIMAL / FOX', color='#ffe480',
         desc='Two pointed ears, one soft face. A quick, recognizable silhouette.',
         icon='<path d="M12 14 L39 30 Q50 26 61 30 L88 14 L84 58 Q80 74 50 90 Q20 74 16 58Z" fill="currentColor"/><path d="M26 47 L43 58 M74 47 L57 58" fill="none" stroke="var(--cutout, white)" stroke-width="7" stroke-linecap="round"/><path d="M44 72 H56 L50 79Z" fill="var(--cutout, white)"/>'),
    dict(id='05-momo', name='Momo', tag='Keep a little mischief.', category='ANIMAL / MONKEY', color='#a9dcd5',
         desc='A stripped-back monkey. A bridge from the existing identity.',
         icon='<circle cx="16" cy="48" r="15" fill="currentColor"/><circle cx="84" cy="48" r="15" fill="currentColor"/><rect x="19" y="16" width="62" height="72" rx="30" fill="currentColor"/><path d="M28 45 Q28 29 40 31 Q47 31 50 38 Q53 31 60 31 Q72 29 72 45 V60 Q72 78 50 78 Q28 78 28 60Z" fill="var(--cutout, white)"/><path d="M39 45 V51 M61 45 V51 M43 65 Q50 70 57 65" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'),
    dict(id='06-seen', name='Seen', tag='The feed looks back.', category='LOGOTYPE / HIDDEN FACE', color='#f6c4d8',
         desc='Eyes tucked inside the ee. The name itself becomes the character.',
         icon='<path d="M10 53 H44 C44 22 9 22 9 53 C9 77 32 82 43 69 M57 53 H91 C91 22 56 22 56 53 C56 77 79 82 90 69" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="41" r="3.8" fill="currentColor"/><circle cx="74" cy="41" r="3.8" fill="currentColor"/>'),
]

def svg(body, w, h, title, color=INK):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" fill="none" color="{color}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>'

def lockup(c, text):
    mark, w = word(text, c['id']=='06-seen')
    if c['id']=='06-seen':
        return f'<g transform="translate(10 8)">{mark}</g>', w+20, 108
    return f'<g transform="translate(4 9) scale(.88)">{c["icon"]}</g><g transform="translate(110 8)">{mark}</g>', w+122, 108

for c in CONCEPTS:
    folder=OUT/c['id']; folder.mkdir(exist_ok=True)
    (folder/'icon.svg').write_text(svg(c['icon'],100,100,c['name']+' icon'))
    for text in ['feed','feed.fun']:
        body,w,h=lockup(c,text)
        (folder/(text+'.svg')).write_text(svg(body,w,h,c['name']+' — '+text))
        (folder/(text+'-white.svg')).write_text(svg('<g style="--cutout:#18221f">'+body+'</g>',w,h,c['name']+' — '+text+' reversed','#ffffff'))

def label(x,y,text,size=14,color=INK,weight=400,extra=''):
    return f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" {extra}>{text}</text>'

board=['<rect width="1280" height="1490" fill="#f5f3ed"/>',label(56,66,'feed / identity explorations',32,weight=700),label(56,101,'A social place for agents. Six simple directions, drawn as vectors.',17,'#626a63'),label(1224,65,'01—06',15,extra='text-anchor="end"')]
for i,c in enumerate(CONCEPTS):
    x=56+(i%2)*594; y=140+(i//2)*420
    card=[f'<rect x="{x}" y="{y}" width="574" height="398" rx="24" fill="white"/>',label(x+26,y+34,f'0{i+1} / {c["name"]}',15,weight=700),label(x+548,y+34,c['category'],10,'#737b75',extra='text-anchor="end"')]
    body,w,h=lockup(c,'feed'); scale=min(1.10,464/w)
    card += [f'<g transform="translate({x+42} {y+83}) scale({scale})" color="{INK}">{body}</g>']
    body,w,h=lockup(c,'feed.fun')
    card += [f'<g transform="translate({x+42} {y+205}) scale(.53)" color="{INK}">{body}</g>']
    card += [f'<rect x="{x+442}" y="{y+174}" width="92" height="92" rx="23" fill="{c["color"]}"/>',f'<g transform="translate({x+457} {y+189}) scale(.62)" color="{INK}" style="--cutout:{c["color"]}">{c["icon"]}</g>']
    card += [label(x+28,y+306,c['tag'],20,weight=700),label(x+28,y+333,c['desc'],12,'#626a63')]
    for j,s in enumerate([16,24,32]):
        card += [f'<g transform="translate({x+28+j*49} {y+355+(32-s)/2}) scale({s/100})" color="{INK}">{c["icon"]}</g>']
    card += [label(x+548,y+377,'16 / 24 / 32 px',10,'#737b75',extra='text-anchor="end"')]
    board.extend(card)
board += [label(56,1446,'CUSTOM PATH LETTERING  /  ONE-COLOR MARKS  /  FEED + FEED.FUN',12,'#626a63'),label(1224,1446,'EXPLORATION — OCT 2026',12,'#626a63',extra='text-anchor="end"')]
(OUT/'contact-sheet.svg').write_text(svg(''.join(board),1280,1490,'feed logo explorations'))

cards=[]
for c in CONCEPTS:
    a,w,h=lockup(c,'feed'); b,wb,hb=lockup(c,'feed.fun')
    cards.append(f'''<article style="--accent:{c['color']}"><header><b>{c['id'][:2]} / {c['name']}</b><small>{c['category']}</small></header><div class="hero short">{svg(a,w,h,c['name'],'currentColor')}</div><div class="hero long">{svg(b,wb,hb,c['name'],'currentColor')}</div><div class="samples"><div class="tile">{svg(c['icon'],100,100,c['name'],'currentColor')}</div><div class="sizes">{''.join(f'<span style="width:{s}px">'+svg(c['icon'],100,100,c['name'],'currentColor')+'</span>' for s in [16,24,32])}</div></div><h2>{c['tag']}</h2><p>{c['desc']}</p><footer><a href="{c['id']}/feed.svg" download>feed.svg ↗</a><a href="{c['id']}/feed.fun.svg" download>feed.fun.svg ↗</a><a href="{c['id']}/icon.svg" download>icon.svg ↗</a></footer></article>''')

html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>feed — logo explorations</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#18221f;font-family:Arial,sans-serif;--card:#fff;--muted:#667069;--cutout:white}body.dark{background:#101713;color:#f6f5ef;--card:#18221f;--muted:#b7c0b8;--cutout:#18221f}main{max-width:1240px;margin:auto;padding:52px 28px}h1{font-size:38px;letter-spacing:-1.5px;margin:0 0 12px}.intro{color:var(--muted);line-height:1.5}.toolbar{display:flex;gap:8px;margin:30px 0}button{border:1px solid #b4beb3;border-radius:50px;padding:11px 21px;background:transparent;color:inherit;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#18221f;color:#fff}body.dark button[aria-pressed=true]{background:#d8f36a;color:#18221f}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:var(--card);border-radius:24px;padding:28px}header{display:flex;align-items:center;justify-content:space-between;gap:15px}small{font-size:10px;letter-spacing:1px;color:var(--muted)}.hero{height:160px;display:flex;align-items:center;padding:20px 8px 0}.hero svg{width:100%;max-width:430px;max-height:130px}.long{display:none}body.domain .short{display:none}body.domain .long{display:flex}.samples{display:flex;justify-content:space-between;align-items:center;margin:6px 0 28px}.tile{background:var(--accent);color:#18221f;--cutout:var(--accent);width:76px;height:76px;border-radius:21px;padding:12px}.sizes{display:flex;gap:20px;align-items:center}.sizes span{display:block}h2{font-size:22px;letter-spacing:-.5px;margin:0 0 12px}p{font-size:14px;color:var(--muted);line-height:1.6;margin:0}footer{display:flex;gap:20px;margin-top:24px;padding-top:20px;border-top:1px solid #89998733}a{color:inherit;font-size:12px;text-underline-offset:4px}.note{margin-top:28px}svg{display:block;width:100%}@media(max-width:760px){.grid{grid-template-columns:1fr}main{padding:30px 16px}h1{font-size:32px}article{padding:24px}small{font-size:8px}.toolbar{flex-wrap:wrap}}
</style><main><h1>feed / identity explorations</h1><p class="intro">A social place for agents. Six simple directions, drawn as vectors.</p><div class="toolbar"><button id="feed" aria-pressed="true">feed</button><button id="domain" aria-pressed="false">feed.fun</button><button id="theme" aria-pressed="false">Dark background</button></div><section class="grid">'''+''.join(cards)+'''</section><p class="note">Original path lettering. Every direction includes a standalone icon, both wordmarks, and white versions. Start with Peep for an agent identity, or Seen for a quieter wordmark.</p></main><script>const f=document.querySelector('#feed'),d=document.querySelector('#domain'),t=document.querySelector('#theme');f.onclick=()=>{document.body.classList.remove('domain');f.setAttribute('aria-pressed','true');d.setAttribute('aria-pressed','false')};d.onclick=()=>{document.body.classList.add('domain');f.setAttribute('aria-pressed','false');d.setAttribute('aria-pressed','true')};t.onclick=()=>{const dark=document.body.classList.toggle('dark');t.setAttribute('aria-pressed',String(dark));t.textContent=dark?'Light background':'Dark background'}</script></html>'''
(OUT/'index.html').write_text(html)
(OUT/'README.md').write_text('''# feed logo explorations

Open `index.html` to switch between feed / feed.fun and light / dark backgrounds. `contact-sheet.svg` is the comparison board.

1. **Peep** — agent face inside a speech bubble. Recommended for a friendly agent-first identity.
2. **Loop** — abstract ribbon f; a less mascot-driven approach.
3. **Finch** — compact bird, a familiar social cue.
4. **Fox** — alert animal silhouette.
5. **Momo** — simplified monkey, a continuity option from the described Feed identity.
6. **Seen** — eyes inside the ee; recommended for a minimal wordmark.

Each directory contains `icon.svg`, `feed.svg`, `feed.fun.svg`, and white variants of both wordmarks. Logos use original geometric paths with no embedded fonts, raster images, or external dependencies. Descriptive text on the comparison board uses system Arial.

Default ink: #18221f. Colored tiles are optional presentation accents. Face details use `--cutout` (white by default); when embedding SVG inline, match this variable to the background. White variants default to #18221f for their cutout details. Exports use vector masks for true transparent cutouts.

Regenerate with `python3 generate.py`. These are concept explorations, not a trademark clearance.
''')

# Convert cutout paint to masks in standalone assets so backgrounds stay transparent.
import re
for p in OUT.glob('*/*.svg'):
    source=p.read_text()
    if 'var(--cutout' in source:
        body_start=source.index('</title>')+8
        body=source[body_start:-6]
        # A white silhouette with black facial details yields true alpha holes.
        mask_body=body.replace('currentColor','white')
        mask_body=re.sub(r'var\(--cutout, white\)', 'black', mask_body)
        mask_id='cut-'+p.parent.name+'-'+p.stem.replace('.','-')
        source=source[:body_start]+f'<defs><mask id="{mask_id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="120">{mask_body}</mask></defs><path d="M0 0H1000V120H0Z" fill="currentColor" mask="url(#{mask_id})"/></svg>'
        p.write_text(source)
    ET.parse(p)
ET.parse(OUT/'contact-sheet.svg')
print('Generated 30 logo SVGs, comparison SVG, and interactive HTML preview.')
