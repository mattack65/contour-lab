import {BufferGeometry,Float32BufferAttribute,ShapeUtils,Vector2} from 'three';
import {inspectRectangleMesh} from './rectangle-union.ts';

const unsupported=()=>new Error('Solid-body export needs one continuous outer wall with a closed contour at both ends. Close gaps between planks or use the normal STL export.');
const area=(ring:number[],p:number[])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+p[a*3]*p[b*3+1]-p[b*3]*p[a*3+1];},0)/2;
function inside(v:number,ring:number[],p:number[]) {
  const x=p[v*3],y=p[v*3+1];let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i]*3,b=ring[j]*3;
    if((p[a+1]>y)!==(p[b+1]>y) && x<(p[b]-p[a])*(y-p[a+1])/(p[b+1]-p[a+1])+p[a])hit=!hit;
  }
  return hit;
}

/** Keep the actual outside wall triangles; replace end annuli by filled caps.
 * Inner walls must separate from the outside after removing the two end caps.
 * No hull, radial resampling, smoothing or guessed closure of side openings. */
export function outerSolid(source:BufferGeometry,progress:(message:string)=>void=()=>{}) {
  progress('Separating the outer wall from the inner wall…');
  const pos=source.getAttribute('position'),index=source.getIndex();
  if(!index)throw unsupported();
  const p:number[]=[],remap=new Uint32Array(pos.count),weld=new Map<string,number>();
  let bottom=Infinity,top=-Infinity;
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),key=`${x},${y},${z}`;
    let id=weld.get(key);if(id===undefined){id=p.length/3;weld.set(key,id);p.push(x,y,z);}
    remap[i]=id;bottom=Math.min(bottom,z);top=Math.max(top,z);
  }
  weld.clear();
  const parent=Uint32Array.from({length:p.length/3},(_,i)=>i);
  const root=(v:number):number=>{while(parent[v]!==v){parent[v]=parent[parent[v]];v=parent[v];}return v;};
  const join=(a:number,b:number)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a;};
  const walls:number[]=[],edges=new Map<string,{a:number;b:number;count:number}>();
  for(let i=0;i<index.count;i+=3) {
    const a=remap[index.getX(i)],b=remap[index.getX(i+1)],c=remap[index.getX(i+2)];
    const za=p[a*3+2],zb=p[b*3+2],zc=p[c*3+2];
    if(za===zb && zb===zc && (za===bottom || za===top))continue;
    walls.push(a,b,c);join(a,b);join(a,c);
    for(const [u,v] of [[a,b],[b,c],[c,a]]) {
      const z=p[u*3+2];if(z!==p[v*3+2] || (z!==bottom && z!==top))continue;
      const key=u<v?`${u},${v}`:`${v},${u}`,old=edges.get(key);
      if(old)old.count++;else edges.set(key,{a:u,b:v,count:1});
    }
  }
  const next=new Map<number,number>(),incoming=new Set<number>();
  for(const edge of edges.values()) {
    if(edge.count===2)continue;
    if(edge.count!==1 || next.has(edge.a) || incoming.has(edge.b))throw unsupported();
    next.set(edge.a,edge.b);incoming.add(edge.b);
  }
  const loops:{ring:number[];z:number;component:number;area:number}[]=[];
  while(next.size) {
    const first=next.keys().next().value!,ring:number[]=[];let v=first;
    do {ring.push(v);const to=next.get(v);if(to===undefined)throw unsupported();next.delete(v);v=to;}while(v!==first);
    if(ring.length<3)throw unsupported();
    loops.push({ring,z:p[first*3+2],component:root(first),area:area(ring,p)});
  }
  const outerAt=(z:number)=>{
    const candidates=loops.filter(l=>l.z===z);
    const outer=candidates.filter(l=>!candidates.some(other=>other!==l&&inside(l.ring[0],other.ring,p)));
    if(outer.length!==1)throw unsupported();return outer[0];
  };
  const low=outerAt(bottom),high=outerAt(top),component=low.component;
  if(high.component!==component || loops.filter(l=>l.component===component).length!==2)throw unsupported();
  // Closing every side component analytically identifies inward cavity walls.
  // Refuse extra positive-volume bodies instead of silently discarding them.
  const volumes=new Map<number,number>();
  const add=(id:number,v:number)=>volumes.set(id,(volumes.get(id)??0)+v);
  const output:number[]=[];
  for(let i=0;i<walls.length;i+=3) {
    const [a,b,c]=walls.slice(i,i+3),id=root(a),x=a*3,y=b*3,z=c*3;
    add(id,(p[x]*(p[y+1]*p[z+2]-p[y+2]*p[z+1])+p[x+1]*(p[y+2]*p[z]-p[y]*p[z+2])+p[x+2]*(p[y]*p[z+1]-p[y+1]*p[z]))/6);
    if(id===component)output.push(a,b,c);
  }
  for(const loop of loops)add(loop.component,-loop.area*loop.z/3);
  if(!(volumes.get(component)!>0) || [...volumes].some(([id,v])=>id!==component&&v>=0))throw unsupported();

  progress('Filling the end contours and checking the solid body…');
  for(const loop of [low,high]) {
    // Reverse the wall boundary to create the outward-oriented cap boundary.
    const ring=[...loop.ring].reverse();
    const ccw=area(ring,p)>0?ring:[...ring].reverse();
    const triangles=ShapeUtils.triangulateShape(ccw.map(i=>new Vector2(p[i*3],p[i*3+1])),[]);
    const capEdges=new Map<string,number>();
    for(const t of triangles)for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;capEdges.set(key,(capEdges.get(key)??0)+1);}
    const emit=(a:number,b:number,c:number)=>{if(loop.z===top)output.push(a,b,c);else output.push(c,b,a);};
    for(const t of triangles) {
      const perimeter:number[]=[];let split=false;
      for(let j=0;j<3;j++) {
        const a=t[j],b=t[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
        perimeter.push(ccw[a]);
        if(capEdges.get(key)===1 && (a+1)%ccw.length!==b) {
          // Earcut may omit collinear contour vertices. Retain all original
          // wall edges by splitting that cap edge through the omitted points.
          for(let k=(a+1)%ccw.length;k!==b;k=(k+1)%ccw.length) {
            const u=ccw[a]*3,v=ccw[b]*3,w=ccw[k]*3;
            const cross=(p[v]-p[u])*(p[w+1]-p[u+1])-(p[v+1]-p[u+1])*(p[w]-p[u]);
            if(Math.abs(cross)>1e-7)throw unsupported();
            perimeter.push(ccw[k]);split=true;
          }
        }
      }
      if(!split)emit(ccw[t[0]],ccw[t[1]],ccw[t[2]]);
      else {
        const id=p.length/3;
        p.push(Math.fround(t.reduce((s,i)=>s+p[ccw[i]*3],0)/3),Math.fround(t.reduce((s,i)=>s+p[ccw[i]*3+1],0)/3),loop.z);
        for(let j=0;j<perimeter.length;j++)emit(perimeter[j],perimeter[(j+1)%perimeter.length],id);
      }
    }
  }
  // Compact so removed inner surfaces don't inflate bounds or buffers.
  const compact:number[]=[],mapped=new Map<number,number>();
  const indices=output.map(v=>{let id=mapped.get(v);if(id===undefined){id=compact.length/3;mapped.set(v,id);compact.push(p[v*3],p[v*3+1],p[v*3+2]);}return id;});
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(compact,3));geometry.setIndex(indices);
  try {
    const audit=inspectRectangleMesh(geometry);
    if(audit.components!==1||audit.euler!==2)throw unsupported();
    geometry.computeVertexNormals();geometry.computeBoundingBox();
    return {geometry,...audit};
  } catch(error){geometry.dispose();throw error;}
}
