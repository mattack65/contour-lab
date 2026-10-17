
import type {RectangleRecipe} from './rectangles.ts';
const n=(v:number)=>String(Number(v.toFixed(2)));
export function suggestSTLName(r:RectangleRecipe,lightweight=false,solid=false,savedBase?:string,reduced=false){
 const size=(top=false)=>{
  const x=top?r.topDiameter:r.diameter,y=top?r.topSizeY:r.bottomSizeY;
  return ['ellipse','rectangle'].includes(top?(r.topOutline??r.outline):r.outline)?n(x)+'x'+n(y):n(x);
 };
 const section=r.section==='circle'?'d'+n(r.width):n(r.width)+'x'+n(r.depth);
 const motion=r.motion==='accelerating'?'accelerating'+n(r.orbitTwist)+'deg-p'+n(r.turnPower)+(r.reverseAcceleration?'-reverse':'')
  :r.motion==='chirp'?'chirp'+n(r.waveAmplitude)+'deg-'+n(r.waveCycles)+'to'+n(r.waveEndCycles)
  :r.motion==='wander'?'wander'+n(r.wanderAmplitude)+'deg-'+r.wanderBends+'bends-s'+r.wanderSeed
  :r.motion==='sine'||r.motion==='zigzag'?r.motion+n(r.waveAmplitude)+'deg-'+n(r.waveCycles)+'waves':'orbit'+n(r.orbitTwist)+'deg';
 const c=r.smoothCavity;
 const bulges=r.bulgePoints?.map(p=>p.sizeX!==undefined?n(p.sizeX)+'by'+n(p.sizeY!):n(p.bulge))??(r.twoBulges?[n(r.bulgeLower),n(r.bulgeUpper)]:[n(r.bulge)]);
 let hash=2166136261;
 for(const ch of JSON.stringify(Object.entries(r).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))))hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;
 const description=[
  r.outline+(r.topOutline&&r.topOutline!==r.outline?'-to-'+r.topOutline:'')+'-'+size()+'to'+size(true),'h'+n(r.height),r.count+'strands',r.section+(r.topSection&&r.topSection!==r.section?'-to-'+r.topSection:'')+'-'+section+([r.section,r.topSection].some(s=>s==='circle'||s==='ellipse')?'-'+(r.sectionSides??32)+'sides':''),
  bulges.length?'bulge'+bulges.join('x'):'no-bulges',motion,'phase'+n(r.phaseTurns),'twist'+n(r.twist)+(r.randomTwist?'random':'')+(r.alternateTwist?'alt':''),
  ...(r.strandSpacing==='perimeter'?['equal-spacing']:[]),
  ...(r.scaleWithPerimeter?['perimeter-sized']:[]),
  ...(r.strandPlacement==='fixed'?['fixed-centres']:[]),
  ...(r.thicknessModulation&&r.thicknessModulation!=='none'&&r.thicknessAmplitude?['thickness-'+r.thicknessModulation+'-'+n(r.thicknessAmplitude)+'pct-'+(n(r.thicknessCycles??1)+'waves')+(r.alternateThickness?'-alt':'')]:[]),
  ...(r.alternateOrbit?['alt']:[]),
  ...(r.bottomDisc?['plate'+n(r.discThickness)+'-hole'+n(r.discHole)]:[]),
  ...(c?['cavity'+n(c.inset)+'-floor'+n(c.floor),...(c.repairInset!==undefined?['fill'+n(c.repairInset)]:[]),...(c.fillPockets?['filled-pockets']:[])]:[]),
  'step'+n(r.layerHeight)
 ].join('_');
 const stem=savedBase??description.slice(0,190)+'_'+hash.toString(16).padStart(8,'0');
 return stem+(solid?'-solid':'')+(lightweight?'-lightweight':reduced?'-reduced':'')+'.stl';
}
export function suggestSmoothWallName(r:RectangleRecipe,savedBase?:string){
 return suggestSTLName(r,false,false,savedBase).replace(/\.stl$/,'-smooth-wall-modifier.stl');
}
export function validSTLName(value:string){
 const stem=value.trim().replace(/\.stl$/i,'').trim();
 if(!stem||/[<>:"/\\|?*\u0000-\u001f]/.test(stem)||/[. ]$/.test(stem)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
  throw new Error('Enter a valid STL filename without folder paths or special filename characters.');
 if(stem.length>230)throw new Error('Shorten the STL filename to 230 characters or fewer.');
 return stem+'.stl';
}
