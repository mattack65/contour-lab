import {centerAt} from './centreline.ts';
import {adaptiveStations} from './adaptive-sampling.ts';
import {BufferGeometry,BufferAttribute} from 'three';
import {cavityContour} from './cavity-contour.ts';
import type {RectangleRecipe,RectangleQuality} from './rectangles.ts';
import type {PreviewDetail} from './preview-settings.ts';

export function cavityCoreMesh(recipe:RectangleRecipe,quality:RectangleQuality,step:number,inset:number,top:number,
  floor=recipe.smoothCavity!.floor,extraKnots:number[]=[],previewDetail:PreviewDetail=1,radialExpansion=0) {
  const segments=quality==='export'?512:128*previewDetail;
  const knots=[floor,...extraKnots,...(recipe.bulgePoints?.map(p=>p.height/100*recipe.height)
    ?? (recipe.twoBulges?[recipe.height/3,2*recipe.height/3]:[recipe.height/2])),top]
    .filter(z=>z>=floor && z<=top).sort((a,b)=>a-b);
  let stations=[floor];
  if(quality==='export')for(const end of knots) {
    const start=stations[stations.length-1];if(end-start<1e-6)continue;
    const n=Math.ceil((end-start)/step);
    for(let j=1;j<=n;j++)stations.push(start+(end-start)*j/n);
  }
  if(quality==='preview') {
    // Smooth surfaces have their own curvature, independent of strand crossings.
    stations=adaptiveStations([...new Set(knots)],2/previewDetail,.1,.03/(previewDetail*previewDetail),
      z=>cavityContour(recipe,z,inset,segments,radialExpansion));
  }
  const p:number[]=[],idx:number[]=[];
  const count=cavityContour(recipe,floor,inset,segments,radialExpansion).length;
  for(const z of stations)for(const [x,y] of cavityContour(recipe,z,inset,segments,radialExpansion))p.push(x,y,z);
  for(let j=0;j<stations.length-1;j++)for(let i=0;i<count;i++) {
    const a=j*count+i,b=j*count+(i+1)%count,c=b+count,d=a+count;
    idx.push(a,b,c,a,c,d);
  }
  for(const [row,z,up] of [[0,floor,false],[stations.length-1,top,true]] as const) {
    const centre=p.length/3,shift=centerAt(recipe,z);p.push(shift.x,shift.y,z);
    for(let i=0;i<count;i++) {
      const a=row*count+i,b=row*count+(i+1)%count;
      if(up)idx.push(centre,a,b);else idx.push(centre,b,a);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(p),3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(idx),1));
  return geometry;
}
