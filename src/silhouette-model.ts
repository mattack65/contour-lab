import {centerAt,CENTER_LIMIT} from './centreline.ts';
import {outlineProfileError, editableBulgePoints, dimensionedBulgePoints, outlineSizeAt, rectangleDiameterRange, outlineYRecipe, rectangleLimits, presetBulgePoints} from './rectangles.ts';
import type {RectangleRecipe} from './rectangles.ts';

export type SilhouetteAxis='x'|'y';
export const cloneShape=(r:RectangleRecipe):RectangleRecipe=>structuredClone(r);
const levelCount=(r:RectangleRecipe)=>r.bulgePoints?.length??(r.twoBulges?2:1);
export function silhouetteLockForced(r:RectangleRecipe,index:number) {
  const last=levelCount(r)+1;
  if(index!==0&&index!==last)return false;
  const shape=index===0?r.outline:r.topOutline??r.outline;
  return shape!=='ellipse'&&shape!=='rectangle';
}
export function silhouetteLocked(r:RectangleRecipe,index:number):boolean {
  const last=levelCount(r)+1;
  return silhouetteLockForced(r,index)||(index===0?r.bottomProportionsLocked:index===last?r.topProportionsLocked:r.bulgePoints?.[index-1]?.lockProportions) !== false;
}
export function silhouetteLevels(r:RectangleRecipe) {
  return [0,...editableBulgePoints(r).map(p=>p.height*r.height/100),r.height].map((height,i,all)=>({
    height,...outlineSizeAt(r,height),centerX:centerAt(r,height).x,centerY:centerAt(r,height).y,name:i===0?'Bottom':i===all.length-1?'Top':`Level ${i}`,
    locked:silhouetteLocked(r,i),lockForced:silhouetteLockForced(r,i),
  }));
}
function materialize(r:RectangleRecipe) {r.bulgePoints=dimensionedBulgePoints(r);return r;}
export function setSilhouetteLock(r:RectangleRecipe,index:number,locked:boolean) {
  const result=materialize(cloneShape(r)),last=result.bulgePoints!.length+1;
  if(index<0||index>last)throw new Error('Choose an existing level.');
  if(index===0)result.bottomProportionsLocked=locked;
  else if(index===last)result.topProportionsLocked=locked;
  else result.bulgePoints![index-1].lockProportions=locked;
  return result;
}
export function levelHeightBounds(r:RectangleRecipe,index:number):[number,number] {
  const levels=silhouetteLevels(r);
  if(index===0)return [0,0];
  if(index===levels.length-1)return [Math.max(rectangleLimits.height[0],levels[index-1].height+.5),rectangleLimits.height[1]];
  return [levels[index-1].height+.5,levels[index+1].height-.5];
}
export function editSilhouette(r:RectangleRecipe,index:number,field:'height'|'span'|'center',value:number,axis:SilhouetteAxis='x') {
  if(!Number.isFinite(value))throw new Error('Enter a finite measurement in millimetres.');
  const result=materialize(cloneShape(r)),levels=silhouetteLevels(r),last=levels.length-1;
  if(!levels[index])throw new Error('Choose an existing level.');
  if(field==='center') {
    if(Math.abs(value)>CENTER_LIMIT)throw new Error(`Centre offsets must be −${CENTER_LIMIT} to ${CENTER_LIMIT} mm.`);
    if(index===0)result[axis==='x'?'bottomCenterX':'bottomCenterY']=value;
    else if(index===last)result[axis==='x'?'topCenterX':'topCenterY']=value;
    else result.bulgePoints![index-1][axis==='x'?'centerX':'centerY']=value;
    return result;
  }
  if(field==='height') {
    const [min,max]=levelHeightBounds(r,index);
    if(value<min||value>max)throw new Error(`Height must be between ${min.toFixed(1)} and ${max.toFixed(1)} mm. Levels cannot cross.`);
    if(index===0)return cloneShape(r);
    if(index===last) {
      result.height=value;
      result.bulgePoints!.forEach((p,i)=>p.height=100*levels[i+1].height/value);
    } else result.bulgePoints![index-1].height=value/result.height*100;
    return result;
  }
  if(value<=0)throw new Error('X and Y sizes must be positive.');
  let {x,y}=levels[index];
  const ratio=value/levels[index][axis];
  if(silhouetteLocked(r,index)){x*=ratio;y*=ratio;}
  else if(axis==='x')x=value;else y=value;
  if(index===0||index===last) {
    result[index===0?'diameter':'topDiameter']=x;
    const shape=index===0?r.outline:r.topOutline??r.outline;
    if(shape==='ellipse'||shape==='rectangle')result[index===0?'bottomSizeY':'topSizeY']=y;
  } else Object.assign(result.bulgePoints![index-1],{sizeX:x,sizeY:y,bulge:0});
  return result;
}
/** The only outline setter, shared by both dropdowns in the visual editor. */
export function setSilhouetteOutline(r:RectangleRecipe,end:'bottom'|'top',outline:RectangleRecipe['outline']|'same') {
  if(!['circle','ellipse','square','rectangle','hexagon',...(end==='top'?['same']:[])].includes(outline))throw new Error('Choose a supported outline.');
  const result=materialize(cloneShape(r)),before=silhouetteLevels(r);
  if(end==='bottom')result.outline=outline as RectangleRecipe['outline'];
  else result.topOutline=outline==='same'?undefined:outline;
  // Newly exposed Y dimensions start at the visible span, not a stale hidden value.
  for(const top of [false,true]) {
    const old=top?r.topOutline??r.outline:r.outline,newShape=top?result.topOutline??result.outline:result.outline;
    if(old!==newShape&&(newShape==='ellipse'||newShape==='rectangle'))result[top?'topSizeY':'bottomSizeY']=before[top?before.length-1:0].y;
  }
  return result;
}
export function presetSilhouetteLevels(r:RectangleRecipe,count:number) {
  const result=cloneShape(r);
  result.bulgePoints=presetBulgePoints(r,count).map(p=>{
    const size=outlineSizeAt(r,p.height*r.height/100);
    const center=centerAt(r,p.height*r.height/100);
    return {...p,centerX:center.x,centerY:center.y,bulge:0,sizeX:size.x,sizeY:size.y,lockProportions:p.lockProportions??true};
  });
  return result;
}
export function canAddSilhouetteLevel(r:RectangleRecipe) {
  const levels=silhouetteLevels(r);
  return levels.some((l,i)=>i>0&&l.height-levels[i-1].height>=1);
}
export function addSilhouetteLevel(r:RectangleRecipe,height?:number) {
  const result=materialize(cloneShape(r)),levels=silhouetteLevels(r);
  if(height===undefined) {
    const gaps=levels.slice(1).map((l,i)=>({start:levels[i].height,end:l.height}));
    gaps.sort((a,b)=>(b.end-b.start)-(a.end-a.start));height=(gaps[0].start+gaps[0].end)/2;
  }
  if(!Number.isFinite(height)||height<=0||height>=r.height||levels.some(l=>Math.abs(l.height-height!)<.5))
    throw new Error('Place a new level at least 0.5 mm from every other level and both ends.');
  const used=new Set(result.bulgePoints!.map(p=>p.seed));let seed=22360;
  while(used.has(seed))seed=(seed+7919)%1000000;
  const size=outlineSizeAt(r,height),center=centerAt(r,height);
  result.bulgePoints!.push({height:height/r.height*100,centerX:center.x,centerY:center.y,bulge:0,sizeX:size.x,sizeY:size.y,lockProportions:true,offset:0,seed});
  result.bulgePoints!.sort((a,b)=>a.height-b.height);return result;
}
export function removeSilhouetteLevel(r:RectangleRecipe,index:number) {
  const result=materialize(cloneShape(r));
  if(index<=0||index>result.bulgePoints!.length)throw new Error('The bottom and top are required. Only interior levels can be removed.');
  result.bulgePoints!.splice(index-1,1);return result;
}
/** Validate the nominal outline only. Strand/cavity validation still belongs to Build. */
export function silhouetteError(r:RectangleRecipe):string|undefined {
  if(!Number.isFinite(r.height)||r.height<10||r.height>345)return 'Total height must be 10–345 mm.';
  const levels=silhouetteLevels(r);
  if(levels.some(l=>![l.centerX,l.centerY].every(n=>Number.isFinite(n)&&Math.abs(n)<=CENTER_LIMIT+1e-8)))return `Centre offsets must be −${CENTER_LIMIT} to ${CENTER_LIMIT} mm.`;
  if(levels.some((l,i)=>!Number.isFinite(l.height)||(i>0&&l.height<=levels[i-1].height)))return 'Levels must rise in order between bottom and top.';
  for(const key of ['diameter','topDiameter','bottomSizeY','topSizeY'] as const)
    if(!Number.isFinite(r[key])||r[key]<=0||r[key]>280)return 'End diameters and X/Y sizes must be greater than zero and at most 280 mm.';
  for(const [axis,profile] of [['X',r],['Y',outlineYRecipe(r)]] as const) {
    const range=rectangleDiameterRange(profile);
    const message=outlineProfileError(axis,range);if(message)return message;
  }
}
