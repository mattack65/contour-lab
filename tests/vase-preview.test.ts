import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {BufferGeometry,BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3} from 'three';
import type {Manifold} from 'manifold-3d';
import {vasePreview} from '../src/vase-preview.ts';
import {rectangleDefaults} from '../src/rectangles.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {geometrySTL} from '../src/export.ts';

function geometry(m:Manifold) {
 const mesh=m.getMesh(),g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(mesh.vertProperties,3));g.setIndex(new BufferAttribute(mesh.triVerts,1));return g;
}
test('vase display has a 0.4 mm XY wall and an open top without changing the export source',async()=>{
 const w=await Module();w.setup();const body=w.Manifold.cylinder(20,20,20,128),g=geometry(body);body.delete();
 const before=Buffer.from(geometrySTL(g).buffer as ArrayBuffer);
 const r=vasePreview(g,{...rectangleDefaults,bottomDisc:false,smoothCavity:undefined},w);
 const mat=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(r.geometry,mat);mesh.updateMatrixWorld();
 try {
  const hits=new Raycaster(new Vector3(0,0,10),new Vector3(1,0,0)).intersectObject(mesh);
  const distances=[...new Set(hits.map(h=>Math.round(h.distance*1e4)/1e4))];
  assert.ok(Math.abs(distances[0]-19.6)<.002);assert.equal(distances.at(-1),20);
  assert.equal(new Raycaster(new Vector3(0,0,21),new Vector3(0,0,-1)).intersectObject(mesh).length,0,'open top and bottom without a plate');
  // Display layers are separate closed rings, not a fused export mesh.
  const layers=new w.Manifold(new w.Mesh({numProp:3,vertProperties:r.geometry.getAttribute('position').array as Float32Array,triVerts:r.geometry.index!.array as Uint32Array}));
  const pieces=layers.decompose();
  try {for(const p of pieces){const g=geometry(p);try{assert.equal(inspectRectangleMesh(g).euler,0);}finally{g.dispose();}}}
  finally {pieces.forEach(p=>p.delete());layers.delete();}
  assert.deepEqual(Buffer.from(geometrySTL(g).buffer as ArrayBuffer),before,'display conversion must never mutate lightweight export input');
 }finally {g.dispose();r.geometry.dispose();mat.dispose();}
});

test('existing plate geometry and its through-hole survive unchanged',async()=>{
 const w=await Module();w.setup();const outer=w.Manifold.cylinder(20,20,20,96),cavity=w.Manifold.cylinder(18,16,16,96),raised=cavity.translate([0,0,2]);
 const tube=outer.subtract(raised),hole=w.Manifold.cylinder(2,5,5,64),body=tube.subtract(hole),g=geometry(body);
 const r=vasePreview(g,{...rectangleDefaults,bottomDisc:true,discThickness:2,discHole:10,smoothCavity:undefined},w);
 const m=new w.Manifold(new w.Mesh({numProp:3,vertProperties:r.geometry.getAttribute('position').array as Float32Array,triVerts:r.geometry.index!.array as Uint32Array}));
 try {
  for(const z of [.01,1,1.99]) {
   const a=body.slice(z),b=m.slice(z),d=a.subtract(b),e=b.subtract(a);
   try {assert.ok(d.area()+e.area()<.0001,`plate at ${z}`);}finally{a.delete();b.delete();d.delete();e.delete();}
  }
  const a=m.slice(10);try {assert.equal(a.toPolygons().length,2);}finally {a.delete();}
  assert.equal(r.geometry.boundingBox!.min.z,0);assert.equal(r.geometry.boundingBox!.max.z,20);
 }finally {for(const x of [outer,cavity,raised,tube,hole,body,m])x.delete();g.dispose();r.geometry.dispose();}
});

test('side gaps and a neck too thin for a 0.4 mm shell give specific feedback',async()=>{
 const w=await Module();w.setup();const outer=w.Manifold.cylinder(20,20,20,64),inner=w.Manifold.cylinder(20,16,16,64),tube=outer.subtract(inner);
 const box=w.Manifold.cube([30,5,5]),shift=box.translate([0,-2.5,8]),broken=tube.subtract(shift),g=geometry(broken);
 try {assert.throws(()=>vasePreview(g,{...rectangleDefaults,bottomDisc:false},w),/continuous outer wall/);}
 finally {g.dispose();for(const m of [outer,inner,tube,box,shift,broken])m.delete();}
 const narrow=w.Manifold.cube([.6,20,10]),n=geometry(narrow);narrow.delete();
 try {assert.throws(()=>vasePreview(n,{...rectangleDefaults,bottomDisc:false},w),/0.4 mm wall pinches or splits near Z/);}
 finally {n.dispose();}
});

test('a closed cavity floor is retained even without a separate plate',async()=>{
 const w=await Module();w.setup();const body=w.Manifold.cylinder(16,12,12,64),g=geometry(body);body.delete();
 const r=vasePreview(g,{...rectangleDefaults,bottomDisc:false,smoothCavity:{inset:3,floor:3}},w);
 const mat=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(r.geometry,mat);mesh.updateMatrixWorld();
 try {
  const hits=new Raycaster(new Vector3(0,0,17),new Vector3(0,0,-1)).intersectObject(mesh);
  assert.ok(hits.length>0);assert.ok(Math.abs(hits[0].point.z-3)<.002,'existing floor retained, top left open');
 } finally {r.geometry.dispose();g.dispose();mat.dispose();}
});

test('non-circular, tapering and moving contours produce closed perimeter layers',async()=>{
 const w=await Module();w.setup();const s=new w.CrossSection([[-20,-12],[20,-12],[20,12],[-20,12]]),base=s.extrude(20,20,30,[1.5,.8]),shift=base.warp(p=>{p[0]+=p[2]*.3;p[1]-=p[2]*.1;});
 const g=geometry(shift),r=vasePreview(g,{...rectangleDefaults,bottomDisc:false},w);
 const layered=new w.Manifold(new w.Mesh({numProp:3,vertProperties:r.geometry.getAttribute('position').array as Float32Array,triVerts:r.geometry.index!.array as Uint32Array}));
 const pieces=layered.decompose();
 try {assert.ok(pieces.length>1);for(const p of pieces){const g=geometry(p);try{const audit=inspectRectangleMesh(g);assert.equal(audit.components,1);assert.equal(audit.euler,0);}finally{g.dispose();}}}
 finally {pieces.forEach(p=>p.delete());layered.delete();r.geometry.dispose();g.dispose();s.delete();base.delete();shift.delete();}
});
