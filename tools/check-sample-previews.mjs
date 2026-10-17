// Run before publishing samples: node tools/check-sample-previews.mjs
import {readFileSync,readdirSync,statSync} from 'node:fs';
const samples=new URL('../samples/',import.meta.url);
const gallery=readFileSync(new URL('README.md',samples),'utf8');
const recipes=readdirSync(samples).filter(name=>name.endsWith('.json'));
for(const recipe of recipes){
 const name=recipe.slice(0,-5);
 for(const relative of [recipe,`images/${name}.jpg`,`models/${name}.stl`]){
  if(!gallery.includes(`](${relative})`))throw new Error(`Missing gallery link: ${relative}`);
  if(!statSync(new URL(relative,samples)).size)throw new Error(`Empty file: ${relative}`);
 }
 const stl=readFileSync(new URL(`models/${name}.stl`,samples));
 if(stl.length>=10_000_000||stl.length!==84+50*stl.readUInt32LE(80))throw new Error(`Invalid or oversized viewing STL: ${name}`);
}
console.log(`${recipes.length} samples have linked image and 3D previews.`);
