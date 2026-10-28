import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rectangleDefaults,validateRectangles,rectangleDiameterRange} from '../src/rectangles.ts';
import {silhouetteError} from '../src/silhouette-model.ts';
import {printerEnvelope,parsePrinterEnvelope,printerShapeError,printerFootprintError,savePrinterEnvelope} from '../src/printer-settings.ts';

test('300 mm default replaces 280, with independent X/Y printer limits',()=>{
 const r=validateRectangles({...rectangleDefaults,outline:'ellipse',diameter:290.57,topDiameter:290.57,bottomSizeY:200,topSizeY:200,bulgePoints:[]});
 assert.equal(silhouetteError(r),undefined);
 assert.equal(printerShapeError(r,{x:300,y:210}),undefined);
 assert.match(printerShapeError(r,{x:280,y:210})!,/X spline reaches 290.57.*280 mm X/);
 assert.match(printerShapeError(r,{x:300,y:190})!,/Y spline reaches 200.*190 mm Y/);
 assert.equal(printerShapeError({...r,diameter:300,topDiameter:300},{x:300,y:210}),undefined);
});
test('spline overshoot is checked between levels',()=>{
 const r={...rectangleDefaults,diameter:280,topDiameter:280,bulgePoints:[{height:30,bulge:0,sizeX:299,sizeY:299,offset:0,seed:1},{height:70,bulge:0,sizeX:299,sizeY:299,offset:0,seed:2}]};
 assert.ok(rectangleDiameterRange(r).max>300);
 assert.match(printerShapeError(r)!,/X spline reaches.*300 mm X/);
 assert.equal(printerShapeError(r,{x:400,y:400}),undefined);
});
test('finished mesh uses combined translated footprint, regardless of origin',()=>{
 assert.match(printerFootprintError({min:{x:-180,y:10},max:{x:130,y:200}})!,/310 × 190/);
 assert.equal(printerFootprintError({min:{x:400,y:-100},max:{x:700,y:200}}),undefined);
});
test('printer preferences persist separately, reject invalid values, and recover from corrupt storage',()=>{
 let stored:string|null=null;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>stored,setItem:(_k:string,v:string)=>stored=v}});
 try{
  assert.deepEqual(printerEnvelope(),{x:300,y:300});
  savePrinterEnvelope({x:350,y:250});assert.deepEqual(printerEnvelope(),{x:350,y:250});
  for(const x of [0,-1,NaN,Infinity,'300'])assert.throws(()=>parsePrinterEnvelope({x,y:300}),/positive/);
  stored='invalid';assert.deepEqual(printerEnvelope(),{x:300,y:300});
 }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});
