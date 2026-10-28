import {MAX_RECIPE_FILE_BYTES} from '../src/recipe-files.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rectangleDefaults,validateRectangles,outlineSizeAt,editableBulgePoints} from '../src/rectangles.ts';
import {silhouetteLevels,editSilhouette,addSilhouetteLevel,removeSilhouetteLevel,silhouetteError,setSilhouetteLock,setSilhouetteOutline,presetSilhouetteLevels,canAddSilhouetteLevel} from '../src/silhouette-model.ts';

const recipe=()=>validateRectangles({...rectangleDefaults,diameter:100,topDiameter:120,height:120,depth:3,bulgePoints:[{height:30,bulge:12,offset:15,seed:111},{height:70,bulge:-5,offset:-20,seed:222}]});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('width edits and height drags preserve the other handles and random data',()=>{
  const r=recipe(),before=structuredClone(r),levels=silhouetteLevels(r);
  const width=editSilhouette(r,1,'span',145);near(silhouetteLevels(width)[1].x,145);assert.deepEqual(r,before);
  const moved=editSilhouette(r,1,'height',45);near(silhouetteLevels(moved)[1].height,45);near(silhouetteLevels(moved)[1].x,levels[1].x);
  assert.equal(moved.bulgePoints![0].offset,15);assert.equal(moved.bulgePoints![1].seed,222);
  const taller=editSilhouette(r,3,'height',150),wider=editSilhouette(r,3,'span',140);
  for(let i=1;i<=2;i++){near(silhouetteLevels(taller)[i].height,levels[i].height);near(silhouetteLevels(taller)[i].x,levels[i].x);near(silhouetteLevels(wider)[i].x,levels[i].x);}
  assert.equal(validateRectangles(taller).height,150);assert.equal(silhouetteError(taller),undefined);
});
test('add/remove levels retains existing seeds, uses sampled width, supports zero and more than seven',()=>{
  const r=recipe(),added=addSilhouetteLevel(r,60);near(outlineSizeAt(added,60).x,outlineSizeAt(r,60).x);
  assert.equal(added.bulgePoints![1].offset,0);assert.equal(added.bulgePoints![0].seed,111);assert.equal(added.bulgePoints![2].seed,222);
  assert.deepEqual(silhouetteLevels(removeSilhouetteLevel(added,2)),silhouetteLevels(r));
  let empty=removeSilhouetteLevel(removeSilhouetteLevel(r,2),1);assert.equal(empty.bulgePoints!.length,0);
  for(let i=0;i<12;i++)empty=addSilhouetteLevel(empty);assert.equal(empty.bulgePoints!.length,12);assert.equal(validateRectangles(empty).bulgePoints!.length,12);
  assert.throws(()=>removeSilhouetteLevel(r,0),/required/);
  assert.throws(()=>editSilhouette(r,1,'height',90),/cannot cross/);assert.throws(()=>addSilhouetteLevel(r,0),/0.5/);
});
test('side view handles reflect elliptical and hexagonal dimensions',()=>{
  const r=validateRectangles({...recipe(),outline:'ellipse',bottomSizeY:80,topSizeY:100});
  const side=editSilhouette(setSilhouetteLock(r,0,false),0,'span',90,'y');assert.equal(side.bottomSizeY,90);assert.equal(side.diameter,100);
  near(silhouetteLevels(side)[1].y,silhouetteLevels(r)[1].y);
  const middle=editSilhouette(r,1,'span',110,'y');near(silhouetteLevels(middle)[1].y,110);
  const hex=validateRectangles({...recipe(),outline:'hexagon'}),edited=editSilhouette(hex,1,'span',100,'y');near(silhouetteLevels(edited)[1].y,100);
});
test('shape warnings catch spline overshoot and recipe round trip preserves edits',()=>{
  const r=editSilhouette(recipe(),1,'span',400);assert.match(silhouetteError(r)!,/spline/);
  const valid=addSilhouetteLevel(editSilhouette(recipe(),1,'span',130));
  assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(valid))),valid);
  const legacy={...rectangleDefaults};assert.equal(legacy.bulgePoints,undefined);silhouetteLevels(legacy);assert.equal(legacy.bulgePoints,undefined);
  assert.equal(editableBulgePoints(addSilhouetteLevel(legacy)).length,2);
});

test('unlocked X/Y splines are independent, locks preserve ratios, and heights preserve both sizes',()=>{
  let r=validateRectangles({...recipe(),outline:'ellipse',bottomSizeY:80,topSizeY:90});
  r=setSilhouetteLock(r,1,false);
  const before=silhouetteLevels(r),x=editSilhouette(r,1,'span',155,'x');
  near(silhouetteLevels(x)[1].x,155);
  for(let z=0;z<=120;z++)near(outlineSizeAt(x,z).y,outlineSizeAt(r,z).y);
  const y=editSilhouette(r,1,'span',115,'y');
  near(silhouetteLevels(y)[1].y,115);
  for(let z=0;z<=120;z++)near(outlineSizeAt(y,z).x,outlineSizeAt(r,z).x);
  const locked=editSilhouette(setSilhouetteLock(r,1,true),1,'span',155,'x');
  near(silhouetteLevels(locked)[1].x/silhouetteLevels(locked)[1].y,before[1].x/before[1].y);
  const moved=editSilhouette(y,1,'height',44),taller=editSilhouette(y,3,'height',150);
  for(const a of [moved,taller])for(let i=1;i<=2;i++) {
    near(silhouetteLevels(a)[i].x,silhouetteLevels(y)[i].x);near(silhouetteLevels(a)[i].y,silhouetteLevels(y)[i].y);
  }
  near(silhouetteLevels(taller)[1].height,before[1].height);
  assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(y))),y);
});

test('Y-only overshoot is rejected and endpoint edits respect locks and preserve interior sizes',()=>{
  const r=validateRectangles({...recipe(),outline:'ellipse',bottomSizeY:80,topSizeY:90});
  const grown=editSilhouette(r,0,'span',125,'x');near(grown.bottomSizeY,100);
  for(let i=1;i<=2;i++){near(silhouetteLevels(grown)[i].x,silhouetteLevels(r)[i].x);near(silhouetteLevels(grown)[i].y,silhouetteLevels(r)[i].y);}
  const bad={...r,bulgePoints:[{height:49,bulge:0,sizeX:100,sizeY:45,offset:0,seed:1},{height:51,bulge:0,sizeX:100,sizeY:270,offset:0,seed:2}]};
  assert.match(silhouetteError(bad)!,/Y spline/);assert.throws(()=>validateRectangles(bad),/Y/);
});

test('outline selectors retain level geometry/random settings and expose visible end sizes',()=>{
 const original=recipe(),middle=silhouetteLevels(original).slice(1,-1);
 const hex=setSilhouetteOutline(original,'bottom','hexagon');
 assert.equal(hex.outline,'hexagon');
 const ellipse=setSilhouetteOutline(hex,'bottom','ellipse');
 near(ellipse.bottomSizeY,100*Math.sqrt(3)/2);
 const squareTop=setSilhouetteOutline(ellipse,'top','square');
 const follow=setSilhouetteOutline(squareTop,'top','same');
 assert.equal(follow.topOutline,undefined);near(follow.topSizeY,120);
 for(const r of [hex,ellipse,squareTop,follow]) {
   assert.deepEqual(silhouetteLevels(r).slice(1,-1),middle);
   assert.deepEqual(r.bulgePoints!.map(p=>[p.offset,p.seed]),[[15,111],[-20,222]]);
   assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(r))),r);
 }
 assert.throws(()=>setSilhouetteOutline(original,'bottom','same'),/supported/);
});

test('random targets stay attached when levels are moved, inserted and removed',()=>{
 const r=recipe();
 const moved=editSilhouette(r,1,'height',40);
 const inserted=addSilhouetteLevel(moved,20);
 assert.equal(inserted.bulgePoints![1].seed,111);assert.equal(inserted.bulgePoints![1].offset,15);
 near(inserted.bulgePoints![1].height*inserted.height/100,40);
 assert.equal(inserted.bulgePoints![0].offset,0);
 const removed=removeSilhouetteLevel(inserted,2);
 assert.equal(removed.bulgePoints![1].seed,222);assert.equal(removed.bulgePoints![1].offset,-20);
 const roundtrip=validateRectangles(JSON.parse(JSON.stringify(removed)));
 assert.deepEqual(roundtrip.bulgePoints,removed.bulgePoints);
});

test('visual presets place zero/one/two levels and addition stops only when spacing is exhausted',()=>{
 const r=recipe();
 for(const n of [0,1,2,12]) {
   const preset=presetSilhouetteLevels(r,n);assert.equal(preset.bulgePoints!.length,n);
   for(let i=0;i<n;i++)near(preset.bulgePoints![i].height,100*(i+1)/(n+1));
   if(n){assert.equal(preset.bulgePoints![0].offset,15);assert.equal(preset.bulgePoints![0].seed,111);}
   assert.equal(validateRectangles(preset).bulgePoints!.length,n);
 }
 const dense=presetSilhouetteLevels({...r,height:10},19);
 assert.equal(canAddSilhouetteLevel(dense),false);
 assert.throws(()=>addSilhouetteLevel(dense),/0.5/);
});

test('large level recipes fit the load limit and survive JSON validation',()=>{
 const r=presetSilhouetteLevels(recipe(),100);
 const text=JSON.stringify({format:'contour-lab',version:3,model:'rectangles',units:'mm',recipe:r},null,2);
 assert.ok(Buffer.byteLength(text)>20000);assert.ok(Buffer.byteLength(text)<MAX_RECIPE_FILE_BYTES);
 assert.deepEqual(validateRectangles(JSON.parse(text).recipe),r);
});
