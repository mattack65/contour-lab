import * as THREE from 'three';

/** Fill the even/odd interior of the inspector's segment soup on the GPU.
 * A triangle fan from each segment to one common anchor toggles the stencil.
 * Shared fan edges cancel by parity: holes, islands and separate strands need
 * no endpoint welding or polygon triangulation. This is a display overlay only.
 */
export class LayerCap extends THREE.Group {
  private readonly mask:THREE.Mesh;
  private readonly fill:THREE.Mesh;
  constructor() {
    super();
    this.mask=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({
      side:THREE.DoubleSide,colorWrite:false,depthWrite:false,depthTest:false,
      stencilWrite:true,stencilFunc:THREE.AlwaysStencilFunc,
      stencilZPass:THREE.InvertStencilOp,
    }));
    this.fill=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({
      color:'#e63832',side:THREE.DoubleSide,toneMapped:false,
      stencilWrite:true,stencilRef:0,stencilFunc:THREE.NotEqualStencilFunc,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
    }));
    // Draw after the body/contours/overhangs, before the amber section outline.
    this.mask.renderOrder=2;this.fill.renderOrder=3;
    this.add(this.mask,this.fill);this.visible=false;
  }
  setSection(points:readonly number[],z:number) {
    this.mask.geometry.dispose();this.fill.geometry.dispose();
    this.mask.geometry=new THREE.BufferGeometry();this.fill.geometry=new THREE.BufferGeometry();
    if(!points.length){this.visible=false;return;}
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let i=0;i<points.length;i+=3){
      minX=Math.min(minX,points[i]);maxX=Math.max(maxX,points[i]);
      minY=Math.min(minY,points[i+1]);maxY=Math.max(maxY,points[i+1]);
    }
    const fan=new Float32Array(points.length/6*9);
    for(let i=0,j=0;i<points.length;i+=6,j+=9) {
      fan.set([minX-1,minY-1,0,points[i],points[i+1],0,points[i+3],points[i+4],0],j);
    }
    this.mask.geometry.setAttribute('position',new THREE.BufferAttribute(fan,3));
    this.fill.geometry.setAttribute('position',new THREE.Float32BufferAttribute([
      minX,minY,0,maxX,minY,0,maxX,maxY,0,minX,minY,0,maxX,maxY,0,minX,maxY,0,
    ],3));
    this.position.z=z;this.visible=true;
  }
}
