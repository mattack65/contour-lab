import * as THREE from 'three';
import type {RectangleRecipe} from './rectangles.ts';
import {centerAt} from './centreline.ts';
import {createLampMaterial,lampColor} from './lamp-material.ts';

type Source={geometry:THREE.BufferGeometry;recipe:RectangleRecipe};
export class LampPreview {
 readonly group=new THREE.Group();
 readonly toggle=document.getElementById('lamp-preview') as HTMLInputElement;
 private note=document.getElementById('lamp-note')!;
 private controls=document.getElementById('lamp-controls')!;
 private worker?:Worker;
 private geometry?:THREE.BufferGeometry;
 private source?:THREE.BufferGeometry;
 private recipe?:RectangleRecipe;
 private shading=createLampMaterial();
 private shade=new THREE.Mesh(new THREE.BufferGeometry(),this.shading.material);
 private fixture=new THREE.Group();
 private ledMaterial=new THREE.MeshBasicMaterial({color:'#ffe6b8',toneMapped:false});
 private disc=new THREE.Mesh(new THREE.CylinderGeometry(30,30,3,96),new THREE.MeshStandardMaterial({color:'#dad8d1',roughness:.65}));
 private led=new THREE.Mesh(new THREE.SphereGeometry(3,24,12),this.ledMaterial);
 private point=new THREE.PointLight('#ffd5a8',1,0,2);
 private values={height:2,brightness:1.5,warmth:3000,translucency:.65,room:.12};
 constructor(private scene:THREE.Scene,private getSource:()=>Source|undefined,private changed:()=>void) {
  this.group.visible=false;this.group.add(this.shade,this.fixture,this.point);scene.add(this.group);
  this.disc.rotation.x=Math.PI/2;this.disc.position.z=-2;this.led.scale.z=.35;this.fixture.add(this.disc,this.led);
  this.toggle.addEventListener('change',()=>this.update());
  for(const key of Object.keys(this.values) as (keyof typeof this.values)[]) {
   const input=document.getElementById('lamp-'+key) as HTMLInputElement;
   input.addEventListener('input',()=>{const n=input.valueAsNumber;if(!Number.isFinite(n))return;this.values[key]=Math.max(Number(input.min),Math.min(Number(input.max),n));this.apply();this.changed();});
  }
  document.getElementById('lamp-fixture')!.addEventListener('change',()=>{this.apply();this.changed();});
 }
 get active(){return this.group.visible;}
 get room(){return this.values.room;}
 get pending(){return !!this.worker;}
 setBusy(busy:boolean){this.toggle.disabled=busy||!this.getSource();}
 pause(){this.worker?.terminate();this.worker=undefined;}
 resume(){if(this.toggle.checked&&!this.geometry)this.update();}
 invalidate(){this.pause();this.group.visible=false;this.geometry?.dispose();this.geometry=undefined;this.source=undefined;this.update();}
 private apply(){
  if(!this.recipe)return;
  const r=this.recipe,center=centerAt(r,0),z=(r.bottomDisc?r.discThickness:0)+this.values.height;
  const color=lampColor(this.values.warmth);
  this.shading.uniforms.lampPosition.value.set(center.x,center.y,z);
  this.shading.uniforms.lampColor.value.copy(color);
  this.shading.uniforms.lampPower.value=this.values.brightness;
  this.shading.uniforms.lampTransmission.value=this.values.translucency;
  this.fixture.position.set(center.x,center.y,z);this.fixture.visible=(document.getElementById('lamp-fixture') as HTMLInputElement).checked;
  this.ledMaterial.color.copy(color).multiplyScalar(2);this.point.color.copy(color);this.point.position.set(center.x,center.y,z);
  this.point.intensity=1000*this.values.brightness;
  for(const [key,value] of Object.entries(this.values)) {
   const output=document.getElementById('lamp-'+key+'-value');
   if(output)output.textContent=key==='warmth'?Math.round(value)+' K':key==='height'?value.toFixed(1)+' mm':key==='brightness'?value.toFixed(1)+'×':Math.round(value*100)+'%';
  }
 }
 private update(){
  this.pause();this.controls.hidden=!this.toggle.checked;
  if(!this.toggle.checked){this.group.visible=false;this.note.hidden=true;this.changed();return;}
  const source=this.getSource();if(!source){this.toggle.checked=false;this.controls.hidden=true;return;}
  this.recipe=source.recipe;this.note.hidden=false;
  const height=document.getElementById('lamp-height') as HTMLInputElement;height.max=String(source.recipe.height);
  this.values.height=Math.min(this.values.height,source.recipe.height);height.value=String(this.values.height);
  const ready=()=>{
   this.shade.geometry=this.geometry!;this.group.visible=true;this.apply();
   this.note.textContent='White plastic · nominal 0.4 mm wall · '+(this.geometry!.index!.count/3).toLocaleString()+' faces. Approximate scattering; brightness is relative. Self-shadowing and light bouncing inside the shade are not simulated. STL exports keep the original model.';
   this.changed();
  };
  if(this.geometry&&this.source===source.geometry){ready();return;}
  this.group.visible=false;this.note.textContent='Preparing the smooth lamp skin… Uncheck to cancel.';this.changed();
  const worker=new Worker(new URL('./lamp.worker.ts',import.meta.url),{type:'module'});this.worker=worker;
  const fail=(message:string)=>{if(this.worker!==worker)return;this.pause();this.toggle.checked=false;this.controls.hidden=true;this.note.textContent='Lamp preview unavailable: '+message;this.changed();};
  worker.onerror=e=>fail(e.message||'The preview worker stopped.');
  worker.onmessage=e=>{
   if(this.worker!==worker||this.getSource()?.geometry!==source.geometry)return;
   if(e.data.error){fail(e.data.error);return;}
   this.pause();this.geometry?.dispose();this.shade.geometry.dispose();
   const data=e.data,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.positions,3));g.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));g.setAttribute('lampShell',new THREE.BufferAttribute(data.shell,1));g.setIndex(new THREE.BufferAttribute(data.indices,1));g.computeBoundingBox();
   this.geometry=g;this.source=source.geometry;ready();
  };
  worker.postMessage({recipe:source.recipe,mesh:{positions:source.geometry.getAttribute('position').array,indices:source.geometry.index!.array}});
 }
}
