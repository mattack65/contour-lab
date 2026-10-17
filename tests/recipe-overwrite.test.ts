import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RecipeFileSession,writeRecipeFile} from '../src/recipe-files.ts';
import type {RecipeFileHandle} from '../src/recipe-files.ts';

test('repeat save replaces the same file including truncating longer previous content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'recipe-save-'));
 try{
  const handle:RecipeFileHandle={name:'test.json',async createWritable(){let text='';return {
   async write(blob){text=await blob.text();},async close(){await writeFile(join(dir,'test.json'),text);},
  };}};
  let picks=0;
  const host={async showSaveFilePicker(){picks++;return handle;}};
  const session=new RecipeFileSession();
  await session.save(host,new Blob(['{"height":200,"description":"long first version"}']),'test.json');
  await session.save(host,new Blob(['{"height":40}']),'test.json');
  assert.equal(picks,1);assert.equal(await readFile(join(dir,'test.json'),'utf8'),'{"height":40}');
  assert.deepEqual(await readdir(dir),['test.json']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('load association, Save as, cancelled/failed writes, and Clear preserve the correct target',async()=>{
 const writes:string[]=[];
 const handle=(name:string,fail=false):RecipeFileHandle=>({name,async createWritable(){return {
  async write(){if(fail)throw new Error('Disk full');writes.push(name);},async close(){},async abort(){},
 };}});
 const old=handle('loaded.json'),copy=handle('copy.json'),session=new RecipeFileSession(),data=new Blob(['{}']);
 session.use(old);
 await session.save({},data,'loaded.json');assert.deepEqual(writes,['loaded.json']);
 await assert.rejects(()=>session.save({async showSaveFilePicker(){throw new DOMException('Cancelled','AbortError');}},data,'copy.json',true));
 assert.equal(session.filename,'loaded.json');
 await assert.rejects(()=>session.save({async showSaveFilePicker(){return handle('failed.json',true);}},data,'failed.json',true),/Disk full/);
 assert.equal(session.filename,'loaded.json');
 await session.save({async showSaveFilePicker(){return copy;}},data,'copy.json',true);
 await session.save({},data,'copy.json');assert.deepEqual(writes,['loaded.json','copy.json','copy.json']);
 session.use(undefined);assert.equal(session.filename,undefined);
 await assert.rejects(()=>session.save({},data,'new.json'),/unavailable/);
});

test('failed write aborts its temporary stream and retains the original error',async()=>{
 let aborted=false;
 await assert.rejects(()=>writeRecipeFile({name:'test.json',async createWritable(){return {
  async write(){throw new Error('Write failed');},async close(){assert.fail('Should not commit');},
  async abort(){aborted=true;throw new Error('Abort failed');},
 };}},new Blob(['{}'])),/Write failed/);
 assert.equal(aborted,true);
});
