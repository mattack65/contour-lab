import {centerAt,CENTER_LIMIT} from './centreline.ts';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {editableBulgePoints, outlineSizeAt} from './rectangles.ts';
import type {RectangleRecipe} from './rectangles.ts';
import {outlineMorphPoints, smoothTransition} from './shape-transition.ts';
import {cloneShape, silhouetteLevels, editSilhouette, addSilhouetteLevel, removeSilhouetteLevel, silhouetteError, levelHeightBounds, setSilhouetteLock, setSilhouetteOutline, presetSilhouetteLevels, canAddSilhouetteLevel} from './silhouette-model.ts';
import type {SilhouetteAxis} from './silhouette-model.ts';

const fmt=(v:number)=>String(Number(v.toFixed(2)));
const button=(text:string,id:string)=>`<button type="button" id="${id}">${text}</button>`;
/** A small, disposable nominal envelope, independent of the expensive strand mesh. */
function envelope(r:RectangleRecipe) {
  const heights=[...new Set([...Array.from({length:129},(_,i)=>r.height*i/128),...silhouetteLevels(r).map(l=>l.height)])].sort((a,b)=>a-b);
  const rings=heights.map(z=>{
    const size=outlineSizeAt(r,z),center=centerAt(r,z);
    return outlineMorphPoints(r.outline,r.topOutline??r.outline,smoothTransition(z/r.height),96).map(([x,y])=>[x*size.x+center.x,y*size.y+center.y,z]);
  });
  const n=rings[0].length,positions=rings.flat(2),indices:number[]=[];
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++) {
    const a=j*n+i,b=j*n+(i+1)%n,c=b+n,d=a+n;indices.push(a,b,c,a,c,d);
  }
  const bottom=positions.length/3,low=centerAt(r,0),high=centerAt(r,r.height);positions.push(low.x,low.y,0,high.x,high.y,r.height);
  for(let i=0;i<n;i++){indices.push(bottom,(i+1)%n,i);const a=(rings.length-1)*n;indices.push(bottom+1,a+i,a+(i+1)%n);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

export function setupSilhouetteEditor(options:{getRecipe:()=>RectangleRecipe;apply:(r:RectangleRecipe)=>void;build:()=>void;structure:()=>void}) {
  const outlineOptions=['circle','ellipse','square','rectangle','hexagon'].map(s=>`<option value="${s}">${s[0].toUpperCase()+s.slice(1)}</option>`).join('');
  const dialog=document.createElement('dialog');dialog.id='silhouette-dialog';dialog.setAttribute('aria-labelledby','silhouette-title');
  dialog.innerHTML=`<header class="silhouette-header"><div><div class="eyebrow">SHAPE STUDIO</div><h2 id="silhouette-title">Shape your silhouette.</h2><p>Drag an edge to change width. Drag a centre sideways to shift it, or up/down to change height. Ctrl + drag locks height; Shift + drag changes height only. Front edits X; Side edits Y. Del removes the selected interior level. All measurements in mm.</p></div><div class="silhouette-actions">${button('Cancel','silhouette-cancel')}${button('Apply & close','silhouette-apply')}${button('Build','silhouette-build')}</div></header>
    <div class="silhouette-toolbar"><div role="group" aria-label="Silhouette view">${button('Front · X','silhouette-front')}${button('Side · Y','silhouette-side')}</div><div>${button('+ Add level','silhouette-add')}${button('Undo','silhouette-undo')}${button('Centre all levels','silhouette-center-all')}${button('Fit views','silhouette-fit')}</div><label class="silhouette-preset">Levels<select id="silhouette-preset" aria-label="Level preset"><option value="">Presets…</option><option value="0">No interior levels</option><option value="1">One level · ½ height</option><option value="2">Two levels · ⅓ and ⅔</option></select></label><span id="silhouette-count"></span></div>
    <p id="silhouette-error" role="alert" hidden></p>
    <div class="silhouette-workspace"><section class="silhouette-section"><div class="silhouette-section-title"><strong>2D profile</strong><span>Double-click empty space to add a level</span></div><div class="silhouette-scroll"><div id="silhouette-diagram"><svg aria-label="Interactive silhouette profile"></svg><div id="silhouette-fields"></div></div></div></section>
    <section class="silhouette-section silhouette-preview"><div class="silhouette-section-title"><strong>Live 3D envelope</strong><span>Drag to orbit · Scroll to zoom</span></div><div id="silhouette-3d"></div><p>The nominal outline, before strands, random offsets, plate and cavity. Each level has independent X and Y sizes. Lock proportions to scale both together; unlock to edit either axis separately. Centre X/Y shift each horizontal level along a smooth centreline. The bottom stays at height 0 mm; the top sets total height.</p><p>Changes stay in this draft until Apply or Build. Esc cancels. Add as many levels as needed, at least 0.5 mm apart. Random offsets are edited in Structure and stay attached to their levels.</p>${button('Apply & edit structure →','silhouette-structure')}</section></div>`;
  document.body.append(dialog);
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>('#silhouette-'+id)!;
  const diagram=get('diagram'),fields=get('fields'),svg=diagram.querySelector('svg')!,host=get('3d');
  svg.setAttribute('tabindex','-1');
  let draft:RectangleRecipe,axis:SilhouetteAxis='x',history:RectangleRecipe[]=[],selected=0;
  let width=740,height=620,scale=1,origin=180,base=570,maxSpan=200,maxHeight=200,viewCenter=0;
  let renderer:THREE.WebGLRenderer|undefined,controls:OrbitControls|undefined,scene:THREE.Scene,camera:THREE.PerspectiveCamera,mesh:THREE.Mesh,rings:THREE.LineSegments;
  let pending=false,dirty=false,numericStart:RectangleRecipe|undefined,drag:{index:number;field:'center'|'span';side:number;lockHeight:boolean;lockCenter:boolean;before:RectangleRecipe;pointer:{x:number;y:number}}|undefined;
  const error=(message?:string)=>{get('error').textContent=message??'';get('error').hidden=!message;};
  const remember=(r:RectangleRecipe)=>{history.push(cloneShape(r));if(history.length>60)history.shift();};
  function redraw3D() {
    dirty=true;if(pending)return;pending=true;
    requestAnimationFrame(()=>{
      pending=false;if(!dialog.open||!renderer)return;
      if(dirty){dirty=false;mesh.geometry.dispose();mesh.geometry=envelope(draft);
        const positions:number[]=[];
        for(const l of silhouetteLevels(draft)) {
          const size=outlineSizeAt(draft,l.height),center=centerAt(draft,l.height),poly=outlineMorphPoints(draft.outline,draft.topOutline??draft.outline,smoothTransition(l.height/draft.height),96);
          poly.forEach(([x,y],i)=>{const next=poly[(i+1)%poly.length];positions.push(x*size.x+center.x,y*size.y+center.y,l.height,next[0]*size.x+center.x,next[1]*size.y+center.y,l.height);});
        }
        rings.geometry.dispose();rings.geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      }
      renderer.render(scene,camera);
    });
  }
  function renderOnly(){if(!renderer)return;renderer.render(scene,camera);}
  function fit3D() {
    if(!renderer)return;
    const g=envelope(draft);g.computeBoundingBox();
    const bounds=g.boundingBox!,size=bounds.getSize(new THREE.Vector3()),target=bounds.getCenter(new THREE.Vector3());g.dispose();
    const halfFov=camera.fov*Math.PI/360,limitingFov=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));
    const d=size.length()*.55/Math.sin(limitingFov);
    controls!.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(1.5,-2.6,1).normalize().multiplyScalar(d));controls!.update();renderOnly();
  }
  function resize3D(){if(!renderer)return;camera.aspect=host.clientWidth/Math.max(1,host.clientHeight);camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);renderOnly();}
  function start3D() {
    try {renderer=new THREE.WebGLRenderer({antialias:true});}catch {host.textContent='3D preview unavailable. You can still edit the 2D profile.';return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#edf0e7');host.replaceChildren(renderer.domElement);
    renderer.domElement.setAttribute('aria-label','Live 3D silhouette');
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(35,1,.1,5000);camera.up.set(0,0,1);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.addEventListener('change',renderOnly);
    scene.add(new THREE.HemisphereLight('#ffffff','#68735f',2.4));const light=new THREE.DirectionalLight('#fff8eb',3);light.position.set(100,-150,300);scene.add(light);
    mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:'#9ba981',roughness:.5,side:THREE.DoubleSide}));
    rings=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#4b6140',transparent:true,opacity:.55}));scene.add(mesh,rings);
    resize3D();fit3D();redraw3D();
  }
  function fit2D() {
    const limits=Array.from({length:193},(_,i)=>{const z=draft.height*i/192,c=centerAt(draft,z)[axis],half=outlineSizeAt(draft,z)[axis]/2;return [c-half,c+half];});
    const low=Math.min(...limits.map(p=>p[0])),high=Math.max(...limits.map(p=>p[1]));
    viewCenter=(low+high)/2;maxSpan=Math.max(80,high-low)*1.18;
    maxHeight=draft.height*1.12;draw();
  }
  function showFields() {
    const levels=silhouetteLevels(draft);
    if(fields.children.length!==levels.length) {
      fields.replaceChildren(...levels.map((l,i)=>{
        const row=document.createElement('div');row.className='silhouette-level';row.dataset.index=String(i);
        const end=i===0?'bottom':i===levels.length-1?'top':undefined;
        row.classList.toggle('silhouette-endpoint',!!end);
        row.innerHTML=`<div class="silhouette-level-name"><strong>${l.name}</strong><label class="silhouette-lock"><input type="checkbox" data-field="lock" aria-label="${l.name} lock proportions">Lock proportions</label>${i>0&&i<levels.length-1?`<button type="button" data-remove="${i}" aria-label="Remove level ${i}" title="Remove level">×</button>`:'<span>end level</span>'}</div><div class="silhouette-level-values"><label>Height <input type="number" step="any" data-field="height" aria-label="${l.name} height" ${i===0?'disabled':''}></label><label>X <input type="number" step="any" data-field="x" aria-label="${l.name} X size"></label><label>Y <input type="number" step="any" data-field="y" aria-label="${l.name} Y size"></label></div><div class="silhouette-level-values silhouette-center-values"><label>Centre X <input type="number" step="any" min="-280" max="280" data-field="centerX" aria-label="${l.name} centre X"></label><label>Y <input type="number" step="any" min="-280" max="280" data-field="centerY" aria-label="${l.name} centre Y"></label></div>${end?`<label class="silhouette-endpoint-outline">Outline<select id="silhouette-${end}-outline" data-outline="${end}" aria-label="${l.name} outline">${end==='top'?'<option value="same">Same as bottom</option>':''}${outlineOptions}</select></label>`:''}`;return row;
      }));
    }
    const sizes=[...fields.children].map(row=>(row as HTMLElement).offsetHeight);
    const tops=levels.map((l,i)=>Math.max(5,base-l.height*scale-sizes[i]/2));
    for(let i=tops.length-2;i>=0;i--)tops[i]=Math.max(tops[i],tops[i+1]+sizes[i+1]+6);
    if(tops[0]>height-sizes[0]-5){tops[0]=height-sizes[0]-5;for(let i=1;i<tops.length;i++)tops[i]=Math.min(tops[i],tops[i-1]-sizes[i]-6);}
    [...fields.children].forEach((node,i)=>{
      const row=node as HTMLElement;row.style.top=tops[i]+'px';row.classList.toggle('selected',selected===i);
      for(const field of ['height','x','y','centerX','centerY'] as const){const input=row.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
        if(document.activeElement!==input)input.value=fmt(levels[i][field]);
        input.setAttribute('aria-label',`${levels[i].name} ${field==='height'?'height':field.startsWith('center')?`centre ${field.slice(-1)}`:`${field.toUpperCase()} size`}`);
      }
      const lock=row.querySelector<HTMLInputElement>('[data-field="lock"]')!;
      lock.checked=levels[i].locked;lock.disabled=levels[i].lockForced;
      lock.title=levels[i].lockForced?'This end outline has fixed proportions. Choose Ellipse or Rectangle to unlock.':'Keep this level’s X/Y ratio when resizing.';
    });return tops;
  }
  function draw() {
    if(!dialog.open)return;
    width=diagram.clientWidth;height=Math.max(360,silhouetteLevels(draft).length*99+129,Math.min(800,window.innerHeight-260));
    diagram.style.height=height+'px';
    scale=Math.min(width*.46/maxSpan,(height-80)/maxHeight);origin=width*.265-viewCenter*scale;
    // Keep the view transform fixed during edits, especially top-height drags.
    base=(height+maxHeight/1.12*scale)/2;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.height=height+'px';
    get('front').setAttribute('aria-pressed',String(axis==='x'));get('side').setAttribute('aria-pressed',String(axis==='y'));
    const levels=silhouetteLevels(draft),tops=showFields();
    const samples=Array.from({length:193},(_,i)=>({z:draft.height*i/192,r:outlineSizeAt(draft,draft.height*i/192)[axis]/2,c:centerAt(draft,draft.height*i/192)[axis]}));
    const coords=(x:number,z:number)=>`${origin+x*scale},${base-z*scale}`;
    let markup='';const tick=maxHeight>150?25:10;
    for(let z=0;z<=maxHeight;z+=tick)markup+=`<line class="silhouette-grid" x1="20" x2="${width*.52}" y1="${base-z*scale}" y2="${base-z*scale}"/><text x="22" y="${base-z*scale-5}" class="silhouette-tick">${z}</text>`;
    markup+=`<path class="silhouette-fill" d="M${samples.map(p=>coords(p.c-p.r,p.z)).join(' L')} L${samples.slice().reverse().map(p=>coords(p.c+p.r,p.z)).join(' L')} Z"/><path class="silhouette-axis" fill="none" d="M${samples.map(p=>coords(p.c,p.z)).join(' L')}"/>`;
    levels.forEach((l,i)=>{
      const y=base-l.height*scale,r=l[axis]/2*scale,cx=origin+l[axis==='x'?'centerX':'centerY']*scale;
      markup+=`<path class="silhouette-connector" d="M${cx+r},${y} L${width*.54},${y} L${width*.565},${tops[i]+(fields.children[i] as HTMLElement).offsetHeight/2}"/><line class="silhouette-plane ${selected===i?'selected':''}" x1="${cx-r}" x2="${cx+r}" y1="${y}" y2="${y}"/>`;
      for(const side of [-1,1])markup+=`<circle class="silhouette-handle" cx="${cx+side*r}" cy="${y}" r="8" data-index="${i}" data-field="span" data-side="${side}" tabindex="0" role="slider" aria-label="${l.name} width handle ${side<0?'left':'right'}" aria-valuemin="1" aria-valuemax="400" aria-valuenow="${fmt(l[axis])}" aria-valuetext="${fmt(l[axis])} mm"/>`;
      markup+=`<rect class="silhouette-centre" x="${cx-7}" y="${y-7}" width="14" height="14" rx="3" data-index="${i}" data-field="center" tabindex="0" role="slider" aria-label="${l.name} centre handle" aria-valuemin="-${CENTER_LIMIT}" aria-valuemax="${CENTER_LIMIT}" aria-valuenow="${fmt(l[axis==='x'?'centerX':'centerY'])}" aria-valuetext="${axis.toUpperCase()} ${fmt(l[axis==='x'?'centerX':'centerY'])} mm; height ${fmt(l.height)} mm"/>`;
    });svg.innerHTML=markup;
    const issue=silhouetteError(draft);error(issue);
    get<HTMLButtonElement>('apply').disabled=!!issue;get<HTMLButtonElement>('build').disabled=!!issue;
    get<HTMLButtonElement>('undo').disabled=!history.length;get<HTMLButtonElement>('add').disabled=!canAddSilhouetteLevel(draft);
    get<HTMLSelectElement>('bottom-outline').value=draft.outline;get<HTMLSelectElement>('top-outline').value=draft.topOutline??'same';
    get('count').textContent=`${levels.length-2} interior levels · width ${axis.toUpperCase()}`;
    redraw3D();
  }
  function change(action:()=>RectangleRecipe) {try{const next=action();remember(draft);draft=next;draw();}catch(e){error((e as Error).message);}}
  function selectLevel(index:number) {
    selected=index;
    [...fields.children].forEach((node,i)=>node.classList.toggle('selected',i===selected));
    svg.querySelectorAll('.silhouette-plane').forEach((node,i)=>node.classList.toggle('selected',i===selected));
  }
  function removeLevel(index:number) {
    if(index<=0||index>=silhouetteLevels(draft).length-1)return;
    selected=0;change(()=>removeSilhouetteLevel(draft,index));svg.focus({preventScroll:true});
  }
  fields.addEventListener('focusin',event=>{
    numericStart=cloneShape(draft);
    const row=(event.target as Element).closest<HTMLElement>('[data-index]');if(row)selectLevel(Number(row.dataset.index));
  });
  svg.addEventListener('focusin',event=>{
    const handle=event.target as SVGElement;if(handle.dataset.index!==undefined)selectLevel(Number(handle.dataset.index));
  });
  const editNumber=(event:Event)=>{
    const input=event.target;if(!(input instanceof HTMLInputElement))return;
    const index=Number(input.closest<HTMLElement>('[data-index]')!.dataset.index);selected=index;
    try{const field=input.dataset.field;
      const next=field==='lock'?setSilhouetteLock(draft,index,input.checked):editSilhouette(draft,index,field==='height'?'height':field?.startsWith('center')?'center':'span',input.valueAsNumber,field==='y'||field==='centerY'?'y':'x');
      if(JSON.stringify(next)!==JSON.stringify(draft)){
        if(numericStart){remember(numericStart);numericStart=undefined;}draft=next;
      }
      input.removeAttribute('aria-invalid');draw();}
    catch(e){input.setAttribute('aria-invalid','true');error((e as Error).message);}
  };
  fields.addEventListener('input',editNumber);fields.addEventListener('change',editNumber);
  fields.addEventListener('click',event=>{
    const target=event.target as Element,b=target.closest<HTMLButtonElement>('[data-remove]');
    if(b){removeLevel(Number(b.dataset.remove));return;}
    const row=target.closest<HTMLElement>('[data-index]');
    if(row){selectLevel(Number(row.dataset.index));if(!target.closest('input,label,button,select,option'))svg.focus({preventScroll:true});}
  });
  function pointerPosition(e:PointerEvent|MouseEvent) {const box=svg.getBoundingClientRect();return {x:(e.clientX-box.left)*width/box.width,y:(e.clientY-box.top)*height/box.height};}
  svg.addEventListener('pointerdown',e=>{
    const target=(e.target as Element).closest<SVGElement>('[data-index]');if(!target||e.button!==0)return;
    const index=Number(target.dataset.index),field=target.dataset.field as 'center'|'span';
    e.preventDefault();svg.focus({preventScroll:true});selectLevel(index);drag={index,field,side:Number(target.dataset.side)||1,lockHeight:e.ctrlKey,lockCenter:e.shiftKey,before:cloneShape(draft),pointer:pointerPosition(e)};svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove',e=>{
    if(!drag)return;const p=pointerPosition(e),level=silhouetteLevels(drag.before)[drag.index];
    const center=level[axis==='x'?'centerX':'centerY'],round=(n:number)=>Math.round(n*10)/10;
    try {
      if(drag.field==='span') {
        const value=Math.max(1,Math.min(400,round(2*((p.x-origin)/scale-center)*drag.side)));
        draft=editSilhouette(drag.before,drag.index,'span',value,axis);
      } else {
        const value=Math.max(-CENTER_LIMIT,Math.min(CENTER_LIMIT,round(center+(p.x-drag.pointer.x)/scale)));
        draft=drag.lockCenter?cloneShape(drag.before):editSilhouette(drag.before,drag.index,'center',value,axis);
        if(drag.index!==0&&!drag.lockHeight) {
          const [min,max]=levelHeightBounds(drag.before,drag.index),height=Math.max(min,Math.min(max,round(level.height-(p.y-drag.pointer.y)/scale)));
          draft=editSilhouette(draft,drag.index,'height',height,axis);
        }
      }
      draw();
    }catch(e){error((e as Error).message);}

  });
  const endDrag=()=>{if(drag){if(JSON.stringify(draft)!==JSON.stringify(drag.before))remember(drag.before);drag=undefined;draw();}};
  svg.addEventListener('pointerup',endDrag);svg.addEventListener('lostpointercapture',endDrag);
  svg.addEventListener('pointercancel',()=>{if(drag){draft=drag.before;drag=undefined;draw();}});
  svg.addEventListener('dblclick',e=>{if((e.target as Element).closest('[data-index]'))return;const p=pointerPosition(e);if(p.x>width*.53)return;change(()=>addSilhouetteLevel(draft,Math.round((base-p.y)/scale*10)/10));});
  svg.addEventListener('keydown',e=>{
    const target=e.target as SVGElement;if(!target.dataset.field||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();const index=Number(target.dataset.index),handle=target.dataset.field as 'center'|'span',side=Number(target.dataset.side)||1;
    const level=silhouetteLevels(draft)[index],step=(e.shiftKey?5:1)*(handle==='span'?2:1);
    const vertical=e.key==='ArrowUp'||e.key==='ArrowDown';
    if(handle==='span'&&vertical)return;if(handle==='center'&&vertical&&index===0)return;
    const field=handle==='center'?(vertical?'height':'center'):'span';
    const value=field==='height'?level.height:field==='center'?level[axis==='x'?'centerX':'centerY']:level[axis];
    const delta=(e.key==='ArrowUp'||e.key==='ArrowRight'?step:-step)*(handle==='span'?side:1);
    change(()=>editSilhouette(draft,index,field,value+delta,axis));
    svg.querySelector<SVGElement>(`[data-index="${index}"][data-field="${handle}"]${handle==='span'?`[data-side="${side}"]`:''}`)?.focus();
  });
  fields.addEventListener('change',event=>{
    const select=event.target;if(!(select instanceof HTMLSelectElement)||!select.dataset.outline)return;
    const end=select.dataset.outline as 'bottom'|'top';
    const value=select.value as RectangleRecipe['outline']|'same';
    change(()=>setSilhouetteOutline(draft,end,value));
  });
  get<HTMLSelectElement>('preset').addEventListener('change',event=>{
    const select=event.target as HTMLSelectElement;if(select.value==='')return;
    const count=Number(select.value);selected=0;change(()=>presetSilhouetteLevels(draft,count));select.value='';
  });
  get('add').addEventListener('click',()=>change(()=>addSilhouetteLevel(draft)));
  get('center-all').addEventListener('click',()=>{
    change(()=>{
      const result=cloneShape(draft);
      result.bottomCenterX=0;result.bottomCenterY=0;result.topCenterX=0;result.topCenterY=0;
      result.bulgePoints?.forEach(p=>{p.centerX=0;p.centerY=0;});
      return result;
    });
    fit2D();fit3D();
  });
  get('undo').addEventListener('click',()=>{if(history.length){draft=history.pop()!;fields.replaceChildren();draw();}});
  for(const [id,value] of [['front','x'],['side','y']] as const)get(id).addEventListener('click',()=>{axis=value;fit2D();});
  get('fit').addEventListener('click',()=>{fit2D();fit3D();});
  get('cancel').addEventListener('click',()=>dialog.close());
  function apply(action:'close'|'build'|'structure') {
    // Clicking a button commits a focused numeric field through its change event.
    const invalid=fields.querySelector<HTMLInputElement>('[aria-invalid="true"]');if(invalid){invalid.focus();error('Correct the highlighted measurement before applying.');return;}
    const issue=silhouetteError(draft);if(issue){error(issue);return;}
    options.apply(cloneShape(draft));dialog.close();if(action==='build')options.build();else if(action==='structure')options.structure();
  }
  get('structure').addEventListener('click',()=>apply('structure'));
  get('apply').addEventListener('click',()=>apply('close'));get('build').addEventListener('click',()=>apply('build'));
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Delete'||e.defaultPrevented||e.repeat||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||drag)return;
    const target=e.target as Element;
    if(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
    e.preventDefault();e.stopPropagation();removeLevel(selected);
  });
  dialog.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();(document.activeElement as HTMLElement)?.blur();apply('build');}});
  dialog.addEventListener('close',()=>{
    drag=undefined;controls?.dispose();controls=undefined;
    if(renderer){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();rings.geometry.dispose();(rings.material as THREE.Material).dispose();renderer.dispose();renderer.forceContextLoss();renderer=undefined;host.replaceChildren();}
  });
  new ResizeObserver(()=>{if(dialog.open){draw();resize3D();}}).observe(diagram);
  new ResizeObserver(()=>{if(dialog.open)resize3D();}).observe(host);
  const open=()=>{draft=cloneShape(options.getRecipe());history=[];axis='x';selected=0;fields.replaceChildren();const structure=document.getElementById('recipe-dialog') as HTMLDialogElement;if(structure.open)structure.close();dialog.showModal();dialog.scrollTop=0;fit2D();start3D();};
  document.querySelectorAll<HTMLButtonElement>('[data-open-silhouette]').forEach(b=>b.addEventListener('click',open));
}
