import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchingRecipeBase,recipeFileBase,recipeSignature,writeRecipeFile} from '../src/recipe-files.ts';

test('saved recipe name follows unchanged parameters and sculpture type, independent of property order',()=>{
  const recipe={height:200,bulge:20},named={base:recipeFileBase('xyz.JSON'),signature:recipeSignature('rectangles',recipe)};
  assert.equal(matchingRecipeBase(named,'rectangles',{bulge:20,height:200}),'xyz');
  assert.equal(matchingRecipeBase(named,'rectangles',{...recipe,bulge:21}),undefined);
  assert.equal(matchingRecipeBase(named,'tree',recipe),undefined);
  assert.equal(matchingRecipeBase(named,'rectangles',recipe),'xyz','restoring settings restores their matching name');
  assert.equal(matchingRecipeBase(undefined,'rectangles',recipe),undefined);
  assert.equal(recipeFileBase('My shade.v2.json'),'My shade.v2');
});

test('native save returns the filename actually chosen and only after write and close',async()=>{
  const events:string[]=[];
  const data=new Blob(['recipe']);
  const name=await writeRecipeFile({name:'chosen.json',async createWritable(){return {
    async write(blob:Blob){assert.equal(blob,data);events.push('write');},async close(){events.push('close');},
  };}},data);
  assert.equal(name,'chosen.json');assert.deepEqual(events,['write','close']);
  await assert.rejects(()=>writeRecipeFile({name:'failed.json',async createWritable(){return {
    async write(){},async close(){throw new Error('Disk full');},
  };}},data),/Disk full/);
});
