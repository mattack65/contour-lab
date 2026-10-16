import {BufferGeometry, BufferAttribute} from 'three';

/** Downward-facing surface angle measured from vertical: vertical=0°, ceiling=90°.
 * Use actual triangle winding, not smoothed vertex normals. Exclude only faces
 * lying on Z=0 (the build plate), never an entire low band of the sculpture. */
export function overhangGeometry(source: BufferGeometry, limitDegrees=45) {
  const p=source.getAttribute('position'), index=source.getIndex();
  if(!p) {
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(),3));
    return {geometry,triangles:0,maxDegrees:0,areaAbove:0,surfaceArea:0};
  }
  const count=index?.count??p.count, selected=new Uint32Array(count);
  const threshold=Math.sin(limitDegrees*Math.PI/180);
  let n=0,maxDegrees=0,areaAbove=0,surfaceArea=0;
  for(let i=0;i<count;i+=3) {
    const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
    if([a,b,c].every(v=>Math.abs(p.getZ(v))<=1e-5)) continue;
    const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a);
    const vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const length=Math.hypot(nx,ny,nz);
    surfaceArea+=length/2;
    if(length>0 && nz<0)maxDegrees=Math.max(maxDegrees,Math.asin(Math.min(1,-nz/length))*180/Math.PI);
    if(length>0 && -nz/length>threshold+1e-12) {
      areaAbove+=length/2;
      selected[n++]=a;selected[n++]=b;selected[n++]=c;
    }
  }
  // Independent display-only buffer: disposing or colouring it cannot alter
  // the original geometry used for slicing or export.
  const positions=new Float32Array(n*3);
  for(let i=0;i<n;i++) {
    const v=selected[i];
    positions[i*3]=p.getX(v);positions[i*3+1]=p.getY(v);positions[i*3+2]=p.getZ(v);
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(positions,3));
  return {geometry,triangles:n/3,maxDegrees,areaAbove,surfaceArea};
}
