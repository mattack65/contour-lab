import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {plateFootprint} from '../src/plate-outline.ts';
import {rectangleDefaults,validateRectangles,generateRectangles} from '../src/rectangles.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {geometrySTL} from '../src/export.ts';
import {BufferGeometry,BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3} from 'three';

test('a continuous scalloped ring keeps valleys; separated feet use their convex envelope',async()=>{
 const wasm=await Module();wasm.setup();
 for(const count of [12,5]) {
  const sections=Array.from({length:count},(_,i)=>{
   const circle=wasm.CrossSection.circle(10,64),a=2*Math.PI*i/count;
   try{return circle.translate([13+30*Math.cos(a),-7+30*Math.sin(a)]);}finally{circle.delete();}
  });
  const result=plateFootprint(sections,[13,-7],wasm),hull=wasm.CrossSection.hull(sections);
  try {
   assert.equal(result.section.toPolygons().length,1,'interior cavity filled');
   if(count===12) {
    assert.equal(result.mode,'contour');
    assert.ok(hull.area()-result.section.area()>10,'scalloped valleys were not bridged');
    const united=wasm.CrossSection.union(sections);
    try {
     const area=(p:number[][])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
     const expected=united.toPolygons().map(area).filter(a=>a>0).reduce((s,a)=>s+a,0);
     assert.ok(Math.abs(result.section.area()-expected)<1e-5);
    }finally{united.delete();}
   } else {
    assert.equal(result.mode,'envelope');
    assert.ok(Math.abs(result.section.area()-hull.area())<1e-5);
   }
  } finally {result.section.delete();hull.delete();sections.forEach(s=>s.delete());}
 }
});

test('legacy plate choice is retained and repair-fill edits invalidate only the dependent base',()=>{
 const {discFollowStrands,...old}=rectangleDefaults;
 assert.equal(validateRectangles(old).discFollowStrands,false);
 assert.throws(()=>validateRectangles({...old,discFollowStrands:'yes'}),/Follow strand/);
 const recipe={...rectangleDefaults,bottomDisc:true,discFollowStrands:true,smoothCavity:{inset:7,floor:0,repairInset:3}};
 assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(recipe))),recipe);
 assert.notEqual(previewBaseKey(recipe),previewBaseKey({...recipe,smoothCavity:{...recipe.smoothCavity,repairInset:2}}));
 assert.notEqual(previewBaseKey(recipe),previewBaseKey({...recipe,smoothCavity:undefined}));
 assert.equal(previewBaseKey(recipe),previewBaseKey({...recipe,smoothCavity:{...recipe.smoothCavity,inset:8}}));
});

test('contour and envelope plates export closed solids with an intact hole, including smooth interior',async()=>{
 for(const count of [20,6])for(const quality of ['preview','export'] as const) {
  const recipe=validateRectangles({...rectangleDefaults,count,section:'circle',width:12,depth:12,height:14,diameter:70,topDiameter:70,
   orbitTwist:0,bottomCenterX:9,bottomCenterY:-5,topCenterX:9,topCenterY:-5,
   bottomDisc:true,discFollowStrands:true,discHole:20,discThickness:2,layerHeight:.5,
   smoothCavity:count===20?{inset:10,floor:0,repairInset:5}:undefined});
  const built=await buildRectangles(recipe,quality,undefined,()=>{},{contours:false});
  const data=geometrySTL(built.geometry),n=data.getUint32(80,true),p=new Float32Array(n*9);
  built.geometry.dispose();
  for(let i=0;i<n;i++)for(let j=0;j<9;j++)p[i*9+j]=data.getFloat32(84+i*50+12+j*4,true);
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(p,3));geometry.setIndex(Array.from({length:n*3},(_,i)=>i));
  const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material);mesh.updateMatrixWorld(true);
  try {
   const audit=inspectRectangleMesh(geometry);assert.equal(audit.components,1);assert.equal(audit.euler,0);
   const hit=(x:number)=>new Raycaster(new Vector3(x,-5,-1),new Vector3(0,0,1)).intersectObject(mesh);
   assert.equal(hit(9).length,0,'centre hole stays open');
   assert.equal(hit(18.9).length,0,'full requested bore is open');
   assert.ok(hit(19.1).length>0,'plate starts at bore edge');
  } finally {geometry.dispose();material.dispose();}
 }
});

test('following strands reach the build plate while legacy feet keep their half-plate overlap',()=>{
 for(const discFollowStrands of [false,true]) {
  const recipe=validateRectangles({...rectangleDefaults,discFollowStrands,bottomDisc:true,height:10,orbitTwist:0});
  const built=generateRectangles(recipe);
  try {assert.equal(built.geometry.boundingBox!.min.z,discFollowStrands?0:recipe.discThickness/2);}
  finally{built.geometry.dispose();}
 }
});
