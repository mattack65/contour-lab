import {outlineMorphPoints} from './shape-transition.ts';
type Point=[number,number];
type Shape='circle'|'ellipse'|'square'|'rectangle'|'hexagon';
type Table={points:Point[];lengths:Float64Array;total:number};
// Normalised profiles share tables across uniform scaling. Bounded cache; no mesh-sized storage.
const tables=new Map<string,Table>();
export function outlineTravel(bottom:Shape,top:Shape,x:number,y:number,t:number) {
  const circular=(bottom==='circle'||bottom==='ellipse')&&(top==='circle'||top==='ellipse')&&x===y;
  if(circular)return {perimeter:Math.PI*x,point:(fraction:number):Point=>{const a=fraction*2*Math.PI;return [x/2*Math.cos(a),y/2*Math.sin(a)];}};
  const scale=Math.max(x,y),nx=x/scale,ny=y/scale,u=bottom===top?0:t;
  const key=`${bottom}:${top}:${nx}:${ny}:${u}`;
  let table=tables.get(key);
  if(!table){
    let points:Point[];
    if(bottom===top&&(bottom==='rectangle'||bottom==='square'))points=[[nx/2,0],[nx/2,ny/2],[-nx/2,ny/2],[-nx/2,-ny/2],[nx/2,-ny/2]];
    else if(bottom===top&&bottom==='hexagon')points=Array.from({length:6},(_,i)=>[nx/2*Math.cos(i*Math.PI/3),ny/Math.sqrt(3)*Math.sin(i*Math.PI/3)]);
    else if(bottom===top)points=Array.from({length:512},(_,i)=>[nx/2*Math.cos(i*Math.PI/256),ny/2*Math.sin(i*Math.PI/256)]);
    else points=outlineMorphPoints(bottom,top,u,512).map(([a,b])=>[a*nx,b*ny]);
    const lengths=new Float64Array(points.length+1);
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];lengths[i+1]=lengths[i]+Math.hypot(b[0]-a[0],b[1]-a[1]);}
    table={points,lengths,total:lengths[points.length]};
    if(tables.size>=128)tables.delete(tables.keys().next().value!);tables.set(key,table);
  }
  const {points,lengths,total}=table;
  return {perimeter:total*scale,point:(fraction:number):Point=>{
    const distance=((fraction%1)+1)%1*total;let lo=0,hi=points.length;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(lengths[mid]<=distance)lo=mid;else hi=mid;}
    const a=points[lo],b=points[(lo+1)%points.length],v=(distance-lengths[lo])/(lengths[lo+1]-lengths[lo]);
    return [(a[0]+(b[0]-a[0])*v)*scale,(a[1]+(b[1]-a[1])*v)*scale];
  }};
}
