import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const select=document.querySelector<HTMLSelectElement>('#sample')!;
const color=document.querySelector<HTMLInputElement>('#color')!;
const save=document.querySelector<HTMLButtonElement>('#save')!;
const status=document.querySelector<HTMLElement>('#status')!;
const names=Object.keys(import.meta.glob('../samples/*.json')).map(p=>p.split('/').pop()!.slice(0,-5)).sort();
for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,1200,false);renderer.setClearColor('#f3f1eb');renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
document.querySelector('#view')!.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.1,5000);camera.up.set(0,0,1);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
scene.add(new THREE.HemisphereLight(0xffffff,0x877a69,2.1));
for(const [x,y,z,power] of [[-200,-300,450,3],[250,100,250,1.5]]){const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(x,y,z);scene.add(light);}
const material=new THREE.MeshStandardMaterial({color:color.value,roughness:.5,metalness:0,side:THREE.DoubleSide});
let mesh:THREE.Mesh|undefined,generation=0;
const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);
function reset(){if(!mesh)return;const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());const distance=Math.max(size.length()*.5,1)/Math.sin(16*Math.PI/180)*1.06;controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(1.1,-1.7,.85).normalize().multiplyScalar(distance));camera.near=Math.max(.01,distance/1000);camera.far=distance*10;camera.updateProjectionMatrix();controls.update();render();}
async function load(){const id=++generation;save.disabled=true;status.textContent='Loading '+select.value+'…';try{const geometry=await new STLLoader().loadAsync('../samples/models/'+encodeURIComponent(select.value)+'.stl');if(id!==generation){geometry.dispose();return;}if(mesh){scene.remove(mesh);mesh.geometry.dispose();}geometry.computeVertexNormals();mesh=new THREE.Mesh(geometry,material);scene.add(mesh);reset();save.disabled=false;status.textContent=select.value+' · '+(geometry.getAttribute('position').count/3).toLocaleString()+' faces · drag to rotate';}catch(error){if(id===generation)status.textContent='Could not load preview: '+(error as Error).message;}}
select.addEventListener('change',()=>void load());color.addEventListener('input',()=>{material.color.set(color.value);render();});document.querySelector('#reset')!.addEventListener('click',reset);
save.addEventListener('click',()=>{render();const a=document.createElement('a');a.download=select.value+'.jpg';a.href=renderer.domElement.toDataURL('image/jpeg',.9);a.click();});
void load();
