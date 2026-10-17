import {defaultCustomProfile,validateCustomProfile,MAX_PROFILE_POINTS,isConvexProfile} from './custom-profile.ts';
import type {ProfilePoint} from './custom-profile.ts';
import './polygon-editor.css';

/** Draft-only modal: Apply commits a copy; Escape/Cancel never change the recipe. */
export function editStrandPolygon(initial:ProfilePoint[]|undefined,title:string,apply:(points:ProfilePoint[])=>void) {
  const dialog=document.createElement('dialog');dialog.className='polygon-editor';
  dialog.setAttribute('aria-label',title);
  dialog.innerHTML=`<header><h2></h2><button type="button" data-cancel aria-label="Close polygon editor">×</button></header>
    <p>Drag corners. Double-click an edge to add a corner. Select a corner and press Delete to remove it.</p>
    <div class="polygon-workspace"><svg viewBox="0 0 440 480" role="img" aria-label="Editable strand cross section" tabindex="0"></svg>
    <aside><label>Start from <select aria-label="Polygon preset"><option value="rectangle">Rectangle</option><option value="diamond">Diamond</option><option value="triangle">Triangle</option><option value="hexagon">Hexagon</option><option value="star">Star</option></select></label><button type="button" data-preset>Use preset</button>
    <h3>Selected corner <span data-index></span></h3><label>Outward · % <input aria-label="Corner outward offset" type="number" step="1" min="-50" max="50"></label>
    <label>Sideways · % <input aria-label="Corner sideways offset" type="number" step="1" min="-50" max="50"></label>
    <button type="button" data-add>Add corner after selected</button><button type="button" data-delete>Delete corner</button><button type="button" data-undo>Undo</button>
    <p>Positive outward values move down, away from the sculpture’s centre; negative values move up, towards it. Sideways runs left/right. Shown before own-axis twist. Width and radial depth set the final size.</p></aside></div>
    <p data-message role="status"></p><footer><button type="button" data-cancel>Cancel</button><button type="button" data-apply>Apply polygon</button></footer>`;
  dialog.querySelector('h2')!.textContent=title;
  const svg=dialog.querySelector('svg')!,message=dialog.querySelector<HTMLElement>('[data-message]')!;
  const inputs=Array.from(dialog.querySelectorAll<HTMLInputElement>('input'));
  const button=(name:string)=>dialog.querySelector<HTMLButtonElement>(`[data-${name}]`)!;
  let points=structuredClone(initial??defaultCustomProfile),selected=0,history:ProfilePoint[][]=[];
  let drag:{pointer:number;before:ProfilePoint[]}|undefined;
  const remember=()=>{history.push(structuredClone(points));if(history.length>50)history.shift();};
  const coords=(event:MouseEvent|PointerEvent):ProfilePoint=>{
    const matrix=svg.getScreenCTM();if(!matrix)return [0,0];
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    return [Math.round(Math.max(-.5,Math.min(.5,(p.y-240)/360))*1000)/1000,Math.round(Math.max(-.5,Math.min(.5,(p.x-220)/360))*1000)/1000];
  };
  const render=()=>{
    // Rotate the drawing only: stored X remains radial/outward, Y tangential.
    const screen=([x,y]:ProfilePoint)=>[220+360*y,240+360*x];
    const drawn=points.map(screen);
    svg.innerHTML=Array.from({length:11},(_,i)=>`<path d="M ${40+i*36} 60 V 420 M 40 ${60+i*36} H 400" class="polygon-grid"/>`).join('')+
      '<path d="M 220 60 V 420 M 40 240 H 400" class="polygon-axis"/><text x="220" y="25" text-anchor="middle" class="polygon-direction">↑ Towards sculpture centre</text><text x="220" y="456" text-anchor="middle" class="polygon-direction">↓ Outside · away from centre</text>'+
      `<polygon points="${drawn.map(p=>p.join(',')).join(' ')}" class="polygon-fill"/>`+
      drawn.map(([x,y],i)=>{const q=drawn[(i+1)%drawn.length];return `<line data-edge="${i}" x1="${x}" y1="${y}" x2="${q[0]}" y2="${q[1]}" class="polygon-edge"/>`;}).join('')+
      drawn.map(([x,y],i)=>`<circle data-point="${i}" cx="${x}" cy="${y}" r="${i===selected?8:6}" class="polygon-corner ${i===selected?'selected':''}"/><text x="${x+12}" y="${y-5}">${i+1}</text>`).join('');
    dialog.querySelector('[data-index]')!.textContent=String(selected+1);
    inputs.forEach((input,i)=>input.value=String(Number((points[selected][i]*100).toFixed(1))));
    button('delete').disabled=points.length<=3;button('add').disabled=points.length>=MAX_PROFILE_POINTS;button('undo').disabled=!history.length;
    try {const valid=validateCustomProfile(points);message.textContent=`${points.length} corners · ${isConvexProfile(valid)?'convex':'concave'} closed polygon.`;message.className='';button('apply').disabled=false;}
    catch(error){message.textContent=(error as Error).message;message.className='polygon-error';button('apply').disabled=true;}
  };
  const remove=()=>{if(points.length<=3)return;remember();points.splice(selected,1);selected=Math.min(selected,points.length-1);render();};
  svg.addEventListener('pointerdown',event=>{
    const target=event.target as SVGElement,index=target.dataset.point;if(index===undefined||event.button!==0)return;
    selected=Number(index);drag={pointer:event.pointerId,before:structuredClone(points)};svg.setPointerCapture(event.pointerId);event.preventDefault();svg.focus();render();
  });
  svg.addEventListener('pointermove',event=>{if(drag?.pointer!==event.pointerId)return;points[selected]=coords(event);render();});
  const endDrag=(event:PointerEvent)=>{if(drag?.pointer!==event.pointerId)return;if(JSON.stringify(drag.before)!==JSON.stringify(points)){history.push(drag.before);if(history.length>50)history.shift();}drag=undefined;render();};
  svg.addEventListener('pointerup',endDrag);
  svg.addEventListener('pointercancel',event=>{if(drag?.pointer!==event.pointerId)return;points=drag.before;drag=undefined;render();});
  svg.addEventListener('dblclick',event=>{const index=(event.target as SVGElement).dataset.edge;if(index===undefined||points.length>=MAX_PROFILE_POINTS)return;remember();selected=Number(index)+1;points.splice(selected,0,coords(event));render();});
  inputs.forEach((input,i)=>input.addEventListener('change',()=>{const value=input.valueAsNumber;if(!Number.isFinite(value)||Math.abs(value)>50){render();return;}remember();points[selected][i]=value/100;render();}));
  button('add').onclick=()=>{if(points.length>=MAX_PROFILE_POINTS)return;remember();const a=points[selected],b=points[(selected+1)%points.length];points.splice(++selected,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);render();};
  button('delete').onclick=remove;
  button('undo').onclick=()=>{const previous=history.pop();if(previous){points=previous;selected=Math.min(selected,points.length-1);render();}};
  button('preset').onclick=()=>{
    remember();const choice=dialog.querySelector('select')!.value;
    points=choice==='rectangle'?structuredClone(defaultCustomProfile):choice==='diamond'?[[0,-.5],[.5,0],[0,.5],[-.5,0]]:choice==='triangle'?[[-.5,-.5],[.5,0],[-.5,.5]]:
      Array.from({length:choice==='star'?10:6},(_,i)=>{const a=2*Math.PI*i/(choice==='star'?10:6),r=choice==='star'&&i%2?.23:.5;return [r*Math.cos(a),r*Math.sin(a)] as ProfilePoint;});
    points=validateCustomProfile(points);selected=0;render();
  };
  dialog.addEventListener('keydown',event=>{if(event.key==='Delete'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();event.stopPropagation();remove();}});
  dialog.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  button('apply').onclick=()=>{try{apply(validateCustomProfile(points));dialog.close();}catch(error){message.textContent=(error as Error).message;message.className='polygon-error';}};
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);render();dialog.showModal();
}
