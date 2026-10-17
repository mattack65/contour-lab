import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute} from 'three';
import {validateCustomProfile,profileArea,defaultCustomProfile} from '../src/custom-profile.ts';
import {rectangleDefaults,validateRectangles,generateRectangles,rectangleCorners,hasSectionTransition} from '../src/rectangles.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {geometrySTL} from '../src/export.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
const notch=validateCustomProfile([[-.5,-.5],[.5,-.5],[.5,.5],[.2,.5],[.2,-.1],[-.2,-.1],[-.2,.5],[-.5,.5]]);
const base={...rectangleDefaults,count:4,width:6,depth:8,height:12,diameter:80,topDiameter:80,orbitTwist:0,twist:0,layerHeight:.5};
test('polygon validation normalizes and orients a simple outline, rejecting invalid boundaries',()=>{
 assert.deepEqual(validateCustomProfile([[2,3],[2,5],[4,5],[4,3]]),[[.5,-.5],[.5,.5],[-.5,.5],[-.5,-.5]]);
 assert.ok(profileArea(notch)>0);
 for(const p of [[],[[0,0],[1,1],[0,1],[1,0]],[[0,0],[1,0],[1,0],[0,1]],[[0,0],[.5,0],[1,0],[0,1]],[[0,0],[1,0],[NaN,1]],Array.from({length:65},(_,i)=>[Math.cos(i),Math.sin(i)])])assert.throws(()=>validateCustomProfile(p));
});
test('old recipes retain geometry; custom shapes round trip, invalidate cache and clear on old-file load',()=>{
 const old=validateRectangles(base),explicit=validateRectangles({...base,customProfile:defaultCustomProfile});
 const a=generateRectangles(old),b=generateRectangles(explicit);
 try{assert.deepEqual(geometrySTL(a.geometry),geometrySTL(b.geometry));}finally{a.geometry.dispose();b.geometry.dispose();}
 const r=validateRectangles({...base,section:'custom',customProfile:notch});
 assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(r))),r);
 assert.notEqual(previewBaseKey(r),previewBaseKey({...r,customProfile:defaultCustomProfile}));
 Object.assign(r,old);assert.equal(r.customProfile,undefined);assert.equal(r.topCustomProfile,undefined);
});
test('concave end caps preserve notches and enclose the expected volume in preview and full STL',()=>{
 for(const quality of ['preview','export'] as const){
  const r=validateRectangles({...base,section:'custom',customProfile:notch});
  const mesh=generateRectangles(r,{quality});
  try {
   const audit=inspectRectangleMesh(mesh.geometry);
   assert.equal(audit.components,4);assert.equal(audit.euler,8);
   assert.ok(Math.abs(audit.volume-profileArea(notch)*r.width*r.depth*r.height*r.count)<.005);
   const stl=geometrySTL(mesh.geometry),n=stl.getUint32(80,true),p=new Float32Array(n*9);
   for(let i=0;i<n;i++)for(let j=0;j<9;j++)p[i*9+j]=stl.getFloat32(84+i*50+12+j*4,true);
   const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(p,3));g.setIndex(Array.from({length:n*3},(_,i)=>i));
   try{assert.equal(inspectRectangleMesh(g).components,4);}finally{g.dispose();}
  }finally{mesh.geometry.dispose();}
 }
});
test('custom transitions reach both endpoint shapes and reject unsupported inward corners clearly',()=>{
 const diamond=validateCustomProfile([[0,-1],[1,0],[0,1],[-1,0]]);
 for(const topSection of ['circle','custom'] as const){
  const r=validateRectangles({...base,section:'custom',customProfile:defaultCustomProfile,topSection,topCustomProfile:diamond,topWidth:6,topDepth:8});
  assert.equal(hasSectionTransition(r),true);
  assert.equal(rectangleCorners(r,0,0).length,rectangleCorners(r,0,r.height).length);
  const mesh=generateRectangles(r);try{assert.equal(inspectRectangleMesh(mesh.geometry).components,4);}finally{mesh.geometry.dispose();}
 }
 assert.throws(()=>validateRectangles({...base,section:'custom',customProfile:notch,topSection:'circle'}),/cannot blend/);
 assert.throws(()=>validateRectangles({...base,section:'custom',customProfile:[[0,0],[1,0],[0,1]],topSection:'circle'}),/bounding-box centre/);
 assert.doesNotThrow(()=>validateRectangles({...base,section:'custom',customProfile:notch,topSection:'custom',topCustomProfile:notch}));
});
test('custom concave strands support twist, taper, thickness waves and perimeter scaling',()=>{
 const r=validateRectangles({...base,section:'custom',customProfile:notch,twist:25,orbitTwist:10,topDiameter:100,scaleWithPerimeter:true,thicknessModulation:'sine',thicknessAmplitude:20,thicknessCycles:2});
 const mesh=generateRectangles(r);try{assert.equal(inspectRectangleMesh(mesh.geometry).components,4);}finally{mesh.geometry.dispose();}
});
test('custom strands fuse with a bottom plate and smooth interior in preview and export',async()=>{
 for(const quality of ['preview','export'] as const){
  const r=validateRectangles({...base,count:12,section:'custom',customProfile:notch,bottomDisc:true,discHole:20,smoothCavity:{inset:6,floor:0,repairInset:0}});
  const result=await buildRectangles(r,quality,undefined,()=>{},{contours:false});
  try{assert.equal(inspectRectangleMesh(result.geometry).components,1);assert.equal(inspectRectangleMesh(result.geometry).euler,0);}finally{result.geometry.dispose();}
 }
});
