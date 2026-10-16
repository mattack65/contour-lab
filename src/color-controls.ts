const validColor=(value:unknown):value is string=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const paletteKey='contour-lab-custom-colors';

function toHsl(hex:string):[number,number,number] {
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  const h=d===0?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  return [h*60,d===0?0:d/(1-Math.abs(2*l-1))*100,l*100];
}
function toHex(h:number,s:number,l:number) {
  s/=100;l/=100;
  const a=s*Math.min(l,1-l);
  const channel=(n:number)=>{
    const k=(n+h/30)%12;
    return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');
  };
  return '#'+channel(0)+channel(8)+channel(4);
}

export function setupColorControls(initial:string,apply:(color:string)=>unknown) {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const trigger=el<HTMLButtonElement>('sculpture-color'),popup=el('color-popover');
  const hue=el<HTMLInputElement>('color-hue'),saturation=el<HTMLInputElement>('color-saturation'),lightness=el<HTMLInputElement>('color-lightness');
  const native=el<HTMLInputElement>('color-native-input');
  let color=initial.toLowerCase();
  let importingSlot:number|null=null;
  // System custom palettes are not exposed by HTML color inputs. Never replace
  // them with guessed defaults; keep empty slots until their colors are copied.
  let palette:(string|null)[]=[null,null,null,null];
  try {
    const stored=JSON.parse(localStorage.getItem(paletteKey)||'null');
    if(Array.isArray(stored))palette=palette.map((_,i)=>validColor(stored[i])?stored[i].toLowerCase():null);
  }catch { /* Empty slots can still be used in this session. */ }
  const swatches:HTMLButtonElement[]=[],saveSlots:HTMLButtonElement[]=[];
  function refresh() {
    trigger.style.setProperty('--chosen-color',color);native.value=color;
    el('color-preview').style.background=color;
    const h=Number(hue.value),s=Number(saturation.value),l=Number(lightness.value);
    saturation.style.background=`linear-gradient(to right,hsl(${h} 0% ${l}%),hsl(${h} 100% ${l}%))`;
    lightness.style.background=`linear-gradient(to right,#000,hsl(${h} ${s}% 50%),#fff)`;
    el('color-slots-hint').hidden=palette.every(Boolean);
    for(let i=0;i<4;i++) {
      const saved=palette[i];
      swatches[i].style.background=saved??'';
      swatches[i].textContent=saved?'':String(i+1);
      swatches[i].title=saved?`Custom color ${i+1}`:`Choose custom color ${i+1} from your existing chooser`;
      swatches[i].setAttribute('aria-pressed',String(saved===color));
      saveSlots[i].style.background=saved??'';
      // Keep slot numbers legible for both dark and light saved colors.
      saveSlots[i].style.color=saved&&toHsl(saved)[2]<50?'#fff':'#293524';
    }
  }
  function syncSliders() {
    const [h,s,l]=toHsl(color);hue.value=String(h);saturation.value=String(s);lightness.value=String(l);
  }
  function choose(next:string) {color=next.toLowerCase();apply(color);syncSliders();refresh();}
  function position() {
    if(!popup.matches(':popover-open'))return;
    const rect=trigger.getBoundingClientRect(),gap=8;
    const beside=rect.left>=popup.offsetWidth+gap*2;
    const left=beside?rect.left-popup.offsetWidth-gap:Math.max(gap,Math.min(rect.left,innerWidth-popup.offsetWidth-gap));
    const below=rect.bottom+gap;
    const top=beside?Math.max(gap,Math.min(rect.top,innerHeight-popup.offsetHeight-gap)):
      below+popup.offsetHeight<=innerHeight-gap?below:Math.max(gap,rect.top-popup.offsetHeight-gap);
    popup.style.left=left+'px';popup.style.top=top+'px';
  }
  function open() {syncSliders();popup.showPopover();position();}
  function storeSlot(index:number) {
    palette[index]=color;
    try{localStorage.setItem(paletteKey,JSON.stringify(palette));}catch{/* Session-only palette. */}
    refresh();el('color-save-note').textContent=`Saved to custom color ${index+1}.`;
  }
  function openNative(anchor:HTMLElement,slot:number|null) {
    importingSlot=slot;native.value=color;
    const rect=anchor.getBoundingClientRect();native.style.left=rect.left+'px';native.style.top=rect.bottom+'px';
    native.showPicker();
  }
  for(let i=0;i<4;i++) {
    const swatch=document.createElement('button');swatch.type='button';swatch.className='color-swatch';swatch.setAttribute('aria-label',`Custom color ${i+1}`);
    swatch.addEventListener('click',()=>{if(palette[i])choose(palette[i]!);else {storeSlot(i);openNative(swatch,i);}});
    el('color-swatches').append(swatch);swatches.push(swatch);
    const save=document.createElement('button');save.type='button';save.textContent=String(i+1);save.setAttribute('aria-label',`Store current color in slot ${i+1}`);
    save.addEventListener('click',()=>storeSlot(i));
    el('color-save-slots').append(save);saveSlots.push(save);
  }
  trigger.addEventListener('click',()=>{if(popup.matches(':popover-open'))popup.hidePopover();else open();});
  el('color-close').addEventListener('click',()=>{popup.hidePopover();trigger.focus({preventScroll:true});});
  popup.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));
  for(const input of [hue,saturation,lightness])input.addEventListener('input',()=>{
    color=toHex(Number(hue.value),Number(saturation.value),Number(lightness.value));apply(color);refresh();
  });
  el('color-native').addEventListener('click',()=>openNative(el('color-native'),null));
  native.addEventListener('input',()=>choose(native.value));
  native.addEventListener('change',()=>{
    choose(native.value);
    if(importingSlot!==null){storeSlot(importingSlot);importingSlot=null;}
  });
  window.addEventListener('resize',position);
  document.addEventListener('scroll',position,true);
  syncSliders();refresh();
}
