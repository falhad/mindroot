import type { MapDoc } from '../types'

export interface HtmlInput {
  /** The map drawn for a light and for a dark page (from `renderSvg` with `interactive: true`). */
  light: string
  dark: string
  width: number
  height: number
  /** `@font-face` rules with the fonts as data URLs. */
  fontCss?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** JSON that is safe inside a `<script>` block: `<` cannot start a closing tag, and line separators cannot break the script. */
const LINE_SEP = String.fromCharCode(0x2028)
const PARA_SEP = String.fromCharCode(0x2029)
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').split(LINE_SEP).join('\\u2028').split(PARA_SEP).join('\\u2029')

/**
 * A single HTML file that shows the map: pan, zoom, collapse branches, and read notes and links.
 * Read-only, no network requests, no external files. The page follows the system light/dark setting.
 */
export function toHtml(doc: MapDoc, input: HtmlInput): string {
  const nodes: Record<string, { t: string; children: string[]; notes?: string; link?: string; files?: string[]; parent: string | null }> = {}
  for (const n of Object.values(doc.nodes)) {
    nodes[n.id] = {
      t: n.text,
      children: n.children,
      parent: n.parentId,
      ...(n.notes?.trim() ? { notes: n.notes } : {}),
      ...(n.link ? { link: n.link } : {}),
      ...(n.attachments?.length ? { files: n.attachments.map((a) => a.name) } : {}),
    }
  }
  const data = safeJson({ title: doc.meta.title, root: doc.root, nodes, width: input.width, height: input.height })
  return `<!doctype html>
<html lang="en" dir="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.meta.title)}</title>
<style>
${input.fontCss ?? ''}
:root{--bg:#f5f6f8;--ink:#0f172a;--muted:#64748b;--panel:#fff;--line:#e2e8f0;--accent:#0d9488;font-family:'Inter Variable',Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Vazirmatn Variable','Noto Sans Arabic',sans-serif}
@media (prefers-color-scheme: dark){:root{--bg:#0e1016;--ink:#e8ebf2;--muted:#8b93a7;--panel:#1b2030;--line:#2a3042;--accent:#2dd4bf}}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--ink)}
#view{position:fixed;inset:0;overflow:hidden;touch-action:none;cursor:grab}#view.drag{cursor:grabbing}
#stage{position:absolute;left:0;top:0;transform-origin:0 0}
.dark-svg{display:none}@media (prefers-color-scheme: dark){.light-svg{display:none}.dark-svg{display:block}}
svg [data-node]{cursor:pointer}svg [data-node].has-kids .hit{cursor:pointer}
.bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:4px;padding:6px;border-radius:14px;background:var(--panel);border:1px solid var(--line);box-shadow:0 6px 24px rgba(0,0,0,.12)}
.bar button{font:inherit;font-size:14px;min-width:36px;height:34px;border-radius:9px;border:0;background:transparent;color:var(--ink);cursor:pointer}.bar button:hover{background:var(--line)}
h1{position:fixed;left:16px;top:12px;margin:0;font-size:15px;font-weight:650;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hint{position:fixed;left:16px;top:36px;margin:0;font-size:12px;color:var(--muted)}
#card{position:fixed;right:16px;top:16px;width:min(340px,calc(100vw - 32px));max-height:70vh;overflow:auto;padding:14px 16px;border-radius:14px;background:var(--panel);border:1px solid var(--line);box-shadow:0 6px 24px rgba(0,0,0,.12);display:none}
#card.on{display:block}#card h2{margin:0 0 6px;font-size:15px}#card p{margin:6px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.5}#card a{color:var(--accent);word-break:break-all}#card .files{font-size:12.5px;color:var(--muted)}
#card button{position:absolute;right:8px;top:6px;border:0;background:none;font-size:18px;color:var(--muted);cursor:pointer}
</style>
</head>
<body>
<h1>${esc(doc.meta.title)}</h1>
<p class="hint">Drag to move, scroll to zoom, click an idea to read its notes, double-click to fold its branch.</p>
<div id="view"><div id="stage"><div class="light-svg">${input.light}</div><div class="dark-svg">${input.dark}</div></div></div>
<div class="bar" role="toolbar" aria-label="Map controls"><button id="zi" aria-label="Zoom in">+</button><button id="zo" aria-label="Zoom out">&minus;</button><button id="fit" aria-label="Fit to screen">Fit</button><button id="ea" aria-label="Expand all">Expand all</button></div>
<div id="card" role="dialog" aria-label="Idea details"><button id="x" aria-label="Close">&times;</button><h2 id="ct" dir="auto"></h2><div id="cb"></div></div>
<script type="application/json" id="map-data">${data}</script>
<script>
(function(){
var M=JSON.parse(document.getElementById('map-data').textContent);
var view=document.getElementById('view'),stage=document.getElementById('stage'),card=document.getElementById('card');
var x=0,y=0,k=1,hidden={};
function apply(){stage.style.transform='translate('+x+'px,'+y+'px) scale('+k+')'}
function fit(){var w=view.clientWidth,h=view.clientHeight,s=Math.min((w-60)/M.width,(h-110)/M.height,2);if(!(s>0))s=1;k=s;x=(w-M.width*s)/2;y=(h-M.height*s)/2-10;apply()}
function zoomAt(f,cx,cy){var nk=Math.max(.1,Math.min(4,k*f));f=nk/k;x=cx-(cx-x)*f;y=cy-(cy-y)*f;k=nk;apply()}
var pts={},last=null,moved=false,startD=0,startK=1;
view.addEventListener('pointerdown',function(e){view.setPointerCapture(e.pointerId);pts[e.pointerId]={x:e.clientX,y:e.clientY};moved=false;last={x:e.clientX,y:e.clientY};if(Object.keys(pts).length==2){var p=Object.keys(pts).map(function(i){return pts[i]});startD=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);startK=k}view.classList.add('drag')});
view.addEventListener('pointermove',function(e){if(!pts[e.pointerId])return;pts[e.pointerId]={x:e.clientX,y:e.clientY};var ids=Object.keys(pts);if(ids.length==2){var p=ids.map(function(i){return pts[i]});var d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(startD>0)zoomAt(startK*d/startD/k,(p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2);moved=true;return}
var dx=e.clientX-last.x,dy=e.clientY-last.y;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;last={x:e.clientX,y:e.clientY};apply()});
function up(e){delete pts[e.pointerId];view.classList.remove('drag')}
view.addEventListener('pointerup',up);view.addEventListener('pointercancel',up);
view.addEventListener('wheel',function(e){e.preventDefault();var f=Math.exp(-e.deltaY*(e.ctrlKey?.01:.0015));zoomAt(f,e.clientX,e.clientY)},{passive:false});
function descendants(id,out){(M.nodes[id].children||[]).forEach(function(c){out.push(c);descendants(c,out)});return out}
function refresh(){var all=document.querySelectorAll('[data-node],[data-edge]');for(var i=0;i<all.length;i++){var el=all[i],id=el.getAttribute('data-node')||el.getAttribute('data-edge');el.style.display=hiddenNow(id)?'none':''}}
function hiddenNow(id){for(var p=M.nodes[id]&&M.nodes[id].parent;p;p=M.nodes[p].parent){if(hidden[p])return true}return false}
function toggle(id){if(!(M.nodes[id].children||[]).length)return;if(hidden[id])delete hidden[id];else hidden[id]=1;refresh()}
function show(id){var n=M.nodes[id];document.getElementById('ct').textContent=n.t||'Idea';var b=document.getElementById('cb');b.textContent='';
if(n.notes){var p=document.createElement('p');p.setAttribute('dir','auto');p.textContent=n.notes;b.appendChild(p)}
if(n.link&&/^https?:\\/\\//i.test(n.link)){var a=document.createElement('a');a.href=n.link;a.textContent=n.link;a.target='_blank';a.rel='noopener noreferrer';var q=document.createElement('p');q.appendChild(a);b.appendChild(q)}
if(n.files&&n.files.length){var f=document.createElement('p');f.className='files';f.textContent='Files: '+n.files.join(', ');b.appendChild(f)}
card.classList.toggle('on',!!(n.notes||n.link||(n.files&&n.files.length)))}
// the pointer is captured while dragging, so find the idea under the pointer instead of using e.target
view.addEventListener('click',function(e){if(moved)return;var t=document.elementFromPoint(e.clientX,e.clientY);var el=t&&t.closest&&t.closest('[data-node]');if(!el){card.classList.remove('on');return}var id=el.getAttribute('data-node');show(id);if(e.detail>=2)toggle(id)});
document.getElementById('zi').onclick=function(){zoomAt(1.25,view.clientWidth/2,view.clientHeight/2)};
document.getElementById('zo').onclick=function(){zoomAt(.8,view.clientWidth/2,view.clientHeight/2)};
document.getElementById('fit').onclick=fit;
document.getElementById('ea').onclick=function(){hidden={};refresh()};
document.getElementById('x').onclick=function(){card.classList.remove('on')};
addEventListener('keydown',function(e){if(e.key==='Escape')card.classList.remove('on');if(e.key==='0')fit()});
addEventListener('resize',fit);fit();
})();
</script>
</body>
</html>
`
}
