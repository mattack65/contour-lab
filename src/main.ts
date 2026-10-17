import {editStrandPolygon} from './polygon-editor.ts';
import {setupSilhouetteEditor} from './silhouette-editor.ts';
import {BuildProgressView} from './build-progress.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pane } from 'tweakpane';

import {previewMesh} from './rectangle-preview.ts';
import type {RectanglePreviewMesh} from './rectangle-preview.ts';
import { geometrySTL } from './export.ts';
import {reduceSTL} from './reduced-export.ts';
import {sliceMesh} from './tree.ts';
import { rectangleDefaults, rectangleLimits, validateRectangles, orbitPathTilt, hasPhaseShift, hasSectionTransition, hasOutlineTransition, outlineSizeAt, editableBulgePoints, baseSectionSizeAt, strandPerimeterScaleAt } from './rectangles.ts';
import type { RectangleRecipe } from './rectangles.ts';
import {overhangGeometry} from './overhang.ts';
import {recipeFileBase,recipeSignature,MAX_RECIPE_FILE_BYTES,RecipeFileSession,recipePickerOptions} from './recipe-files.ts';
import type {NamedRecipe,RecipePickerHost,OpenRecipeHandle} from './recipe-files.ts';
import {suggestSTLName,suggestSmoothWallName,validSTLName} from './export-names.ts';
import {previewParameters,previewKey,previewBaseKey,parsePreviewDetail} from './preview-settings.ts';
import type {PreviewDetail} from './preview-settings.ts';
import {askFilename} from './filename-dialog.ts';
import {setupRecipeLayout} from './recipe-layout.ts';
import {LayerCap} from './layer-cap.ts';
import {setupColorControls} from './color-controls.ts';
import './style.css';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const humanText=(message:string)=>message.replace(/\bplanks\b/gi,'strands').replace(/\bplank\b/gi,'strand');
const status = (message: string) => { el('status').textContent = humanText(message); };
// Presentation only: remove floating-point noise without rounding recipe values.
const displayNumber = (value: number) => String(Number(value.toFixed(2)));
// Saved *Inset values keep their historical positive-inward convention.
// Only presentation reverses the sign: negative inward, positive outward.
const radialOffsetText = (value:number) => value===0?'off':`up to ${displayNumber(Math.abs(value))}% ${value>0?'inward':'outward'}`;
const outlineDimensions = (r: RectangleRecipe,z: number) => {
  const size=outlineSizeAt(r,z);
  return (z===r.height?(r.topOutline??r.outline):r.outline)==='circle' ? `Ø ${displayNumber(size.x)} mm`
    : `${displayNumber(size.x)} × ${displayNumber(size.y)} mm`;
};
const rectangles={...rectangleDefaults};
const selection={model:'rectangles'};
function showRecipeMigration(value:unknown){
  const retired=(value as {thicknessModulation?:unknown}|null)?.thicknessModulation==='random';
  const note=el('recipe-migration');
  note.hidden=!retired;
  note.textContent=retired?'This recipe used the retired Smooth random thickness option. Thickness modulation is now Off; all other settings were kept.':'';
}
try {
  const saved=JSON.parse(localStorage.getItem('contour-lab-study-v2')||'null');
  if(saved?.rectangles){Object.assign(rectangles,validateRectangles(saved.rectangles));showRecipeMigration(saved.rectangles);}
}catch {status('Saved recipe could not be restored; using the defaults.');}
const cavityOptions={enabled:false,inset:3,floor:2,repair:false,repairInset:0,fillPockets:false};
function restoreCavityOptions() {
  const c=rectangles.smoothCavity;cavityOptions.enabled=!!c;
  if(c)Object.assign(cavityOptions,{inset:c.inset,floor:c.floor,repair:c.repairInset!==undefined,repairInset:c.repairInset??0,fillPockets:c.fillPockets??false});
}
restoreCavityOptions();
function commitCavityOptions() {
  rectangles.smoothCavity=cavityOptions.enabled?{inset:cavityOptions.inset,floor:cavityOptions.floor,
    ...(cavityOptions.repair?{repairInset:cavityOptions.repairInset}:{}),...(cavityOptions.fillPockets?{fillPockets:true}:{})}:undefined;
}
function showError(message:string) {
  el('build-error').textContent=humanText(message);el('build-error').hidden=false;status(message);
}
let generation = 0;
let geometryWorker: Worker | undefined;
let buildAbort: AbortController | undefined;
let displayedModel = '';
let displayedRecipe = '';
let exporting = false;
let exportAbort: AbortController | undefined;
let building = false;
const solidExport=el<HTMLInputElement>('solid-export');
const previewDetailPicker=el<HTMLFieldSetElement>('preview-detail');
let previewDetail:PreviewDetail=1,displayedPreviewDetail:PreviewDetail=1;
try {previewDetail=parsePreviewDetail(localStorage.getItem('contour-lab-preview-detail'));}catch { /* Standard by default. */ }
previewDetailPicker.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.checked=input.value===String(previewDetail));

function previewIsCurrent() { return displayedModel === selection.model && !!displayedRecipe && previewKey(JSON.parse(displayedRecipe),displayedPreviewDetail)===previewKey(rectangles,previewDetail); }
function cavityBottomText(r:RectangleRecipe) {
  const c=r.smoothCavity!;
  return c.floor===0
    ? r.bottomDisc?'cavity floor off; original '+displayNumber(r.discThickness)+' mm plate and '+(r.discHole?'Ø '+displayNumber(r.discHole)+' mm hole':'solid centre')+' preserved'
      :'cavity floor off; open bottom'
    :displayNumber(c.floor)+' mm closed bottom; plate hole filled';
}
function updateExportButtons() {
  const cavity=selection.model==='rectangles'&&rectangles.smoothCavity;
  solidExport.disabled=exporting||!!cavity;
  if(cavity)solidExport.checked=false;
  el<HTMLInputElement>('stl-step').disabled=exporting;
  previewDetailPicker.disabled=building||exporting;
  for(const id of ['export','export-reduced','export-lightweight','export-smooth-wall']) {
    el<HTMLButtonElement>(id).disabled=building||exporting||!previewIsCurrent()||(id!=='export-lightweight'&&!el<HTMLInputElement>('stl-step').checkValidity())
      ||(id==='export-smooth-wall'&&(!cavity||cavity.repairInset===undefined));
  }
}
function updateBuildButton(message: string) {
  for(const id of ['build','build-recipe']) {
    const button=el<HTMLButtonElement>(id);
    button.disabled=building||exporting;
    button.textContent=building?'Building…':id==='build-recipe'?'Build · Ctrl+Enter':'Build';
  }
  document.querySelectorAll<HTMLButtonElement>('[data-open-silhouette], #expand-recipe').forEach(b=>b.disabled=building||exporting);
  el<HTMLButtonElement>('clear').disabled=building||exporting||recipeIOBusy;
  const cancel=el<HTMLButtonElement>('cancel-build');
  cancel.hidden=!building;cancel.disabled=!!buildAbort?.signal.aborted;
  cancel.textContent=cancel.disabled?'Cancelling…':'Cancel';
  el('build-state').textContent = humanText(message);
}
const buildProgress=new BuildProgressView(el('build-progress'));
function currentRecipe() { return rectangles; }
function recipeName() { return suggestSTLName(rectangles).replace(/\.stl$/,''); }
const recipeFiles=new RecipeFileSession();
const recipePickers=window as Window & RecipePickerHost;
let recipeIOBusy=false;
let namedRecipe:NamedRecipe|undefined;
try {
  const saved=JSON.parse(localStorage.getItem('contour-lab-named-recipe')||'null');
  if(typeof saved?.base==='string'&&typeof saved?.signature==='string'&&recipeFileBase(saved.base)) {
    // Add defaulted fields to an older saved signature just as recipe loading does.
    // Existing recipe filenames must keep matching after an additive upgrade.
    const [model,entries]=JSON.parse(saved.signature);
    if(model==='rectangles')saved.signature=recipeSignature(model,validateRectangles(Object.fromEntries(entries)));
    if(typeof saved.filename!=='string')delete saved.filename;
    namedRecipe=saved;
  }
} catch { /* Naming is optional; geometry restoration is independent. */ }
function rememberRecipeName(filename:string,model:string,params:object) {
  const base=recipeFileBase(filename);
  if(!base)return;
  namedRecipe={base,filename,signature:recipeSignature(model,params)};
  updateRecipeFilename();
  try {localStorage.setItem('contour-lab-named-recipe',JSON.stringify(namedRecipe));}catch { /* Session-only fallback. */ }
}
function updateRecipeFilename() {
  const name=namedRecipe?.filename|| (namedRecipe?namedRecipe.base+'.json':'Unsaved');
  const modified=!!namedRecipe&&namedRecipe.signature!==recipeSignature(selection.model,currentRecipe());
  el('current-recipe').textContent='Recipe: '+name+(modified?' · modified':'');
  el('current-recipe').title=name;
}
updateRecipeFilename();
const viewport = el('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3f1eb');
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
camera.up.set(0, 0, 1);
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
} catch (error) {
  viewport.innerHTML = '<p class="webgl-error">WebGL is unavailable. Open this workspace in a browser with hardware acceleration enabled.</p>';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor('#f3f1eb');
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Lighting and sculpture stay fixed while the camera moves.
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.domElement.setAttribute('aria-label', 'Orbitable sculpture');
viewport.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', () => status('Graphics context lost. Reload to restore the preview.'));
const controls = new OrbitControls(camera, renderer.domElement);
// Follow the pointer directly: frame-based inertia feels sluggish when frames stall.
controls.enableDamping = false;
controls.minDistance = 35;
controls.maxDistance = 1400;
// Allow orbiting all the way underneath the sculpture.
controls.maxPolarAngle = Math.PI;
controls.autoRotateSpeed = 1;
let renderPending=false;
let lastFrameTime=0;
function requestRender(refreshShadow=false) {
  if(refreshShadow)renderer.shadowMap.needsUpdate=true;
  if(renderPending)return;
  renderPending=true;
  requestAnimationFrame(time=>{
    renderPending=false;
    if(document.hidden){lastFrameTime=0;return;}
    const delta=lastFrameTime?Math.min((time-lastFrameTime)/1000,.1):1/60;
    lastFrameTime=time;
    // change events raised during this update are covered by the current frame.
    renderPending=true;
    controls.update(delta);
    // Keep the ground guides from covering the underside.
    floor.visible=camera.position.z>=floor.position.z;
    grid.visible=camera.position.z>=grid.position.z;
    renderer.render(scene,camera);
    renderPending=false;
    if(controls.autoRotate)requestRender();
    else lastFrameTime=0;
  });
}
controls.addEventListener('change',()=>requestRender());
document.addEventListener('visibilitychange',()=>{lastFrameTime=0;requestRender();});


scene.add(new THREE.HemisphereLight('#fff9ed', '#888d85', 2.3));
const key = new THREE.DirectionalLight('#fff4df', 3.2);
key.position.set(-70, -100, 160);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -130, right: 130, top: 180, bottom: -100, near: 1, far: 500 });
key.shadow.normalBias = 0.3;
scene.add(key);
const fill = new THREE.DirectionalLight('#e8f0ff', 2);
fill.position.set(60, 70, 100);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.ShadowMaterial({ color: '#57534b', opacity: 0.12 }));
floor.position.z = -0.12;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(200, 20, '#c3c5bb', '#dadbd2');
grid.rotation.x = Math.PI / 2;
grid.position.z = -0.16;
scene.add(grid);

const material = new THREE.MeshStandardMaterial({ color: '#b56649', roughness: 0.73, metalness: 0.03, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const lineMaterial = new THREE.LineBasicMaterial({ color: '#553b2d', transparent: true, opacity: 0.58 });
// Display preference only: independent of recipe/build identity and STL export.
function applySculptureColor(value:string,persist=true) {
  const color=value.startsWith('#')?value:'#'+value;
  if(!/^#[0-9a-f]{6}$/i.test(color))return false;
  material.color.set(color);
  lineMaterial.color.set(color).multiplyScalar(.4);
  if(persist)try {localStorage.setItem('contour-lab-sculpture-color',color.toLowerCase());}catch { /* Session preference still works. */ }
  requestRender();return true;
}
try {applySculptureColor(localStorage.getItem('contour-lab-sculpture-color')||'#b56649',false);}
catch { /* Keep the default material when browser storage is unavailable. */ }
setupColorControls('#'+material.color.getHexString(),applySculptureColor);
const finishPicker=el<HTMLFieldSetElement>('sculpture-finish');
const finishes={matte:.73,satin:.4,glossy:.1};
function applySculptureFinish(value:string,persist=true) {
  if(!Object.hasOwn(finishes,value))return;
  material.roughness=finishes[value as keyof typeof finishes];
  finishPicker.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.checked=input.value===value);
  if(persist)try {localStorage.setItem('contour-lab-sculpture-finish',value);}catch { /* Session preference still works. */ }
  requestRender();
}
try {applySculptureFinish(localStorage.getItem('contour-lab-sculpture-finish')||'matte',false);}
catch { /* Keep the default matte finish. */ }
finishPicker.addEventListener('change',event=>{
  const input=event.target;
  if(input instanceof HTMLInputElement&&input.checked)applySculptureFinish(input.value);
});
const highlightMaterial = new THREE.LineBasicMaterial({ color: '#e3ae26', depthTest: false });
const sculpture = new THREE.Mesh(new THREE.BufferGeometry(), material);
sculpture.castShadow = true;
sculpture.receiveShadow = false;
const contours = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
const highlight = new THREE.LineSegments(new THREE.BufferGeometry(), highlightMaterial);
highlight.visible = false;
highlight.renderOrder = 10;
scene.add(sculpture, contours, highlight);
const layerCap=new LayerCap();
scene.add(layerCap);
const overhangMaterial=new THREE.MeshBasicMaterial({color:'#ef2424',toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
const overhangOverlay=new THREE.Mesh(new THREE.BufferGeometry(),overhangMaterial);
overhangOverlay.visible=false;overhangOverlay.renderOrder=1;scene.add(overhangOverlay);
let overhangSource:THREE.BufferGeometry|undefined;
let overhangTriangles=0;
let maximumOverhang=0;
let overhangArea=0,overhangSurfaceArea=0;
let analyzedThreshold=NaN;
function updateOverhangs() {
  requestRender();
  const enabled=el<HTMLInputElement>('show-overhangs').checked;
  const threshold=el<HTMLInputElement>('overhang-threshold').valueAsNumber;
  overhangOverlay.visible=enabled;
  el('overhang-note').hidden=!enabled;
  if(!enabled)return;
  if(!Number.isFinite(threshold)||threshold<0||threshold>90)return;
  if(overhangSource!==sculpture.geometry||analyzedThreshold!==threshold) {
    const result=overhangGeometry(sculpture.geometry,threshold);
    overhangOverlay.geometry.dispose();overhangOverlay.geometry=result.geometry;
    overhangSource=sculpture.geometry;overhangTriangles=result.triangles;maximumOverhang=result.maxDegrees;analyzedThreshold=threshold;
    overhangArea=result.areaAbove;overhangSurfaceArea=result.surfaceArea;
  }
  const areaText=overhangArea>0&&overhangArea<.01?'<0.01':overhangArea.toLocaleString(undefined,{maximumFractionDigits:2});
  const percent=overhangSurfaceArea?100*overhangArea/overhangSurfaceArea:0;
  const percentText=percent>0&&percent<.01?'<0.01':percent.toFixed(2);
  el('overhang-note').textContent=`Maximum surface overhang: ${maximumOverhang.toFixed(1)}° from vertical. Above ${threshold}°: ${areaText} mm² (${percentText}% of the surface), ${overhangTriangles.toLocaleString()} preview faces. Build-plate contact excluded. Preview guide, not a printability guarantee.`;
}
el('show-overhangs').addEventListener('change',updateOverhangs);
el('overhang-threshold').addEventListener('input',updateOverhangs);
let viewMode = 'solid';
let contourWorker:Worker|undefined;
let contoursReady=false;
let cachedRectangleBase:{key:string;mesh:RectanglePreviewMesh}|undefined;

function stopContourWorker() {
  contourWorker?.terminate();contourWorker=undefined;
}

/** Slice the already fused displayed mesh, without rebuilding or blocking orbit controls. */
function requestContours() {
  if(viewMode==='solid'||displayedModel!=='rectangles'||!displayedRecipe||contoursReady||contourWorker)return;
  const source=sculpture.geometry;
  const worker=new Worker(new URL('./rectangles.worker.ts',import.meta.url),{type:'module'});
  contourWorker=worker;
  const fail=(message:string)=>{
    if(contourWorker!==worker)return;
    stopContourWorker();
    if(!building&&!exporting&&previewIsCurrent())status(message);
  };
  worker.onerror=event=>fail(event.message||'Could not prepare contours. Switch to Solid and try again.');
  worker.onmessage=event=>{
    if(contourWorker!==worker||sculpture.geometry!==source)return;
    if(event.data.error){fail(event.data.error);return;}
    stopContourWorker();
    contours.geometry.dispose();contours.geometry=new THREE.BufferGeometry();
    contours.geometry.setAttribute('position',new THREE.BufferAttribute(event.data.lines,3));
    contoursReady=true;requestRender();
    if(!building&&!exporting&&previewIsCurrent()&&viewMode!=='solid')status('Contours ready.');
  };
  if(!building&&!exporting&&previewIsCurrent())status('Preparing contours from the fused preview…');
  worker.postMessage({operation:'contours',height:JSON.parse(displayedRecipe).height,
    mesh:{positions:source.getAttribute('position').array,indices:source.index!.array}});
}
const layerHeights=(r:{height:number})=>{
  const limit=r.height+1;
  const count=Math.ceil(limit/.2);
  return Array.from({length:count+1},(_,i)=>Math.min(i*.2,limit));
};
let heights = layerHeights(rectangles);
const layer = el<HTMLInputElement>('layer');
const showLayerInspector = el<HTMLInputElement>('show-layer-inspector');
const hideAboveLayer = el<HTMLInputElement>('hide-above-layer');
// Keep the half-space z <= selected height, without changing mesh geometry.
const layerClipPlane = new THREE.Plane(new THREE.Vector3(0,0,-1),0);
const layerClipPlanes = [layerClipPlane];
let cutawayActive=false;
function updateLayerCutaway(z:number) {
  const enabled=showLayerInspector.checked&&hideAboveLayer.checked&&!!displayedRecipe;
  const changed=enabled!==cutawayActive;
  const moved=enabled&&layerClipPlane.constant!==z;
  layerClipPlane.constant=z;
  if(changed) {
    cutawayActive=enabled;
    for(const target of [material,lineMaterial,overhangMaterial]) {
      target.clippingPlanes=enabled?layerClipPlanes:null;
      target.clipShadows=true;
      target.needsUpdate=true;
    }
  }
  requestRender(changed||moved);
}
hideAboveLayer.addEventListener('change',updateSlice);
try { showLayerInspector.checked = localStorage.getItem('contour-lab-layer-inspector') === 'true'; }
catch { /* Default off when preferences are unavailable. */ }

function updateSlice() {
  requestRender();
  el('layer-inspector').hidden = !showLayerInspector.checked;
  highlight.visible = showLayerInspector.checked && !!displayedRecipe;
  const index = Math.min(Number(layer.value), heights.length - 1);
  const z = heights[index];
  updateLayerCutaway(z);
  layerCap.visible=false;
  // Hidden inspection should not scan a potentially multi-million-face mesh.
  if (!highlight.visible) return;
  const points=sliceMesh(sculpture.geometry,z);
  if(cutawayActive)layerCap.setSection(points,z);
  highlight.geometry.dispose();
  highlight.geometry = new THREE.BufferGeometry();
  highlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  el('layer-height').innerHTML = `${z.toFixed(1)} <small>mm</small>`;
  el('layer-index').textContent = z>(sculpture.geometry.boundingBox?.max.z??Infinity)?'Above model':`Contour ${index} / ${heights.length - 1}`;
  el('layer-count').textContent = '0.20 mm inspection steps';

}

interface LatticeResult { geometry: THREE.BufferGeometry; lines: Float32Array; triangles: number; components: number; sampleStep: number; uncored?:RectanglePreviewMesh; filledPockets?:number; filledVolume?:number }
function buildGeometry<T = LatticeResult>(params: RectangleRecipe, quality: 'preview'|'export', worker: Worker, signal?: AbortSignal, extra:Record<string,unknown>={}): Promise<T> {
  return new Promise((resolve,reject) => {
    const jobId=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
    let settled=false;
    const cleanup = () => { settled=true;worker.onmessage=null;worker.onerror=null;worker.terminate();signal?.removeEventListener('abort',abort); };
    const abort = () => {
      if(settled)return;
      cleanup();
      // Send from the main thread: terminating a busy WASM worker cannot run its cleanup.
      void fetch('/api/native/cancel',{method:'POST',headers:{'X-Contour-Job-ID':jobId},signal:AbortSignal.timeout(5000)})
        .then(async response=>{
          if(!response.ok)throw new Error('Cancellation was not acknowledged');
          const result=await response.json();
          reject(new DOMException(result.finished?'Build cancelled.':'Browser work stopped; native cancellation is still finishing.','AbortError'));
        }).catch(()=>reject(new DOMException('Browser work stopped, but native cancellation could not be confirmed.','AbortError')));
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = async event => {
      cleanup();
      let message=event.message || 'Geometry worker stopped unexpectedly. Reload the page and try again.';
      try {
        const response=await fetch('/',{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(3000)});
        if(!response.ok)message=`The local app server returned HTTP ${response.status}. Check Docker and the server, then reload the page.`;
      } catch {
        message='The local app server is unreachable. Start Docker Desktop and the project container, then reload the page and click Build.';
      }
      reject(new Error(message));
    };
    worker.onmessage = event => {
      if(settled)return;
      if(event.data.progress) {status(event.data.progress);if(building&&worker===geometryWorker)buildProgress.update(humanText(event.data.progress),event.data.work);return;}
      cleanup();
      if(event.data.error) {
        if(quality==='preview'&&event.data.uncored)cachedRectangleBase={key:previewBaseKey(params,parsePreviewDetail(extra.previewDetail)),mesh:event.data.uncored};
        reject(new Error(event.data.error));return;
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(event.data.positions,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(event.data.normals,3));
      geometry.setIndex(new THREE.BufferAttribute(event.data.indices,1));
      geometry.computeBoundingBox();
      resolve({...event.data,geometry});
    };
    worker.postMessage({recipe:params,quality,...extra,jobId});
  });
}
async function rebuild() {
  if (exporting||building) return;
  const ticket=++generation;
  const controller=new AbortController();buildAbort=controller;
  geometryWorker?.terminate();
  el('build-error').hidden=true;
  building=true;updateBuildButton('Building these settings…');
  const started = performance.now();
  const previousFraction = Number(layer.value) / Math.max(Number(layer.max), 1);
  const model=selection.model;
  const current={...currentRecipe()};
  const detail=previewDetail;
  const previous=JSON.parse(displayedRecipe||'{}');
  const reframe=!displayedRecipe||['outline','topOutline','bottomSizeY','topSizeY','bottomCenterX','bottomCenterY','topCenterX','topCenterY','height','diameter','topDiameter','bulge','bulgeLower','bulgeUpper','bulgePoints'].some(k=>JSON.stringify(previous[k])!==JSON.stringify(current[k as keyof RectangleRecipe]));
  let result:LatticeResult;
  updateExportButtons();
  status('Updating preview…');
  buildProgress.start({cavity:!!current.smoothCavity,reuseBase:cachedRectangleBase?.key===previewBaseKey(current,detail)});
  try {
    const preview=validateRectangles(previewParameters(current,detail));
    geometryWorker=new Worker(new URL('./rectangles.worker.ts',import.meta.url),{type:'module'});
    const cached=cachedRectangleBase?.key===previewBaseKey(current,detail)?cachedRectangleBase.mesh:undefined;
    const source=cached?{mesh:cached,reuseBase:true,sampleStep:cached.sampleStep,components:cached.components}:undefined;
    if(cached)status('Reusing the checked strands; updating the interior…');
    result=await buildGeometry<LatticeResult>(preview,'preview',geometryWorker,controller.signal,{...source,contours:false,previewDetail:detail});
  } catch(error) {
    if(ticket===generation) {
      building=false;buildAbort=undefined;geometryWorker=undefined;
      if(controller.signal.aborted) {
        buildProgress.finish('cancelled');
        const message=(error as Error).message+(displayedRecipe?' Previous preview retained.':'');
        updateBuildButton(message);status(message);
      } else {
        buildProgress.finish('failed');showError('Could not build: '+(error as Error).message.replace(/[. ]+$/,'')+'. '+(displayedRecipe?'Previous preview retained.':''));
        updateBuildButton('Could not build: '+(error as Error).message);
      }
    }
    updateExportButtons();return false;
  }
  if(ticket!==generation) {result.geometry.dispose();return;}
  buildAbort=undefined;geometryWorker=undefined;
  buildProgress.update('Preparing display…',{phase:'display'});
  displayedModel=model; displayedRecipe=JSON.stringify(current);displayedPreviewDetail=detail;
  stopContourWorker();
  if(model==='rectangles') {
    const lattice=result as LatticeResult;
    const base=lattice.uncored??(!(current as RectangleRecipe).smoothCavity?previewMesh(lattice.geometry,lattice.sampleStep,lattice.components):undefined);
    cachedRectangleBase=base?{key:previewBaseKey(current,detail),mesh:base}:undefined;
  } else cachedRectangleBase=undefined;
  const pocketNote=result.filledPockets===undefined?'':result.filledPockets===0?' No enclosed wall pockets found.':` Filled ${result.filledPockets} enclosed wall pockets.`;
  building=false;updateBuildButton('Preview is up to date.'+pocketNote);
  sculpture.geometry.dispose();
  sculpture.geometry = result.geometry;
  requestRender(true);
  overhangSource=undefined;
  overhangOverlay.geometry.dispose();overhangOverlay.geometry=new THREE.BufferGeometry();
  updateOverhangs();
  material.flatShading=model==='rectangles';material.needsUpdate=true;
  const lines=result.lines;
  contours.geometry.dispose();
  contours.geometry = new THREE.BufferGeometry();
  contours.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  contoursReady=model!=='rectangles'||lines.length>0;
  const top=result.geometry.boundingBox!.max.z;
  heights = layerHeights({...current,height:top});
  layer.max = String(heights.length - 1);
  layer.value = String(Math.round(previousFraction * (heights.length - 1)));
  updateSlice();
  const bounds = result.geometry.boundingBox!;
  el('stat-height').textContent = `${top.toFixed(1)} mm`;
  el('stat-width').textContent = `${(bounds.max.x - bounds.min.x).toFixed(1)} × ${(bounds.max.y - bounds.min.y).toFixed(1)} mm`;
  el('build-dimensions').hidden=false;
  el('specimen-seed').textContent=rectangles.count+' strands · '+strandDimensions(rectangles)+(hasSectionTransition(rectangles)?' → '+strandDimensions(rectangles,rectangles.height):'');
  el('specimen-title').textContent=rectangles.smoothCavity?'SMOOTH INTERIOR':rectangles.section.toUpperCase()+(hasSectionTransition(rectangles)?' → '+rectangles.topSection!.toUpperCase():'')+' STRANDS';
  el('study-title').textContent='STRANDS / '+rectangles.outline.toUpperCase()+(hasOutlineTransition(rectangles)?' → '+rectangles.topOutline!.toUpperCase():'');
  el('growth-note').textContent=outlineDimensions(rectangles,0)+' bottom → '+outlineDimensions(rectangles,rectangles.height)+' top; height '+displayNumber(rectangles.height)+' mm. '+(rectangles.smoothCavity?'Smooth interior: '+displayNumber(rectangles.smoothCavity.inset)+' mm radial inset; '+cavityBottomText(rectangles)+'.':'Original strand geometry.');
  el('export-note').textContent='Preview step up to '+displayNumber(result.sampleStep)+' mm. Full STL step '+displayNumber(rectangles.layerHeight)+' mm. Z up; all dimensions in millimetres.';
  el('lightweight-note').textContent=result.triangles.toLocaleString()+' preview faces · '+((84+50*result.triangles)/1e6).toFixed(1)+' MB. For viewing and sharing.';
  buildProgress.finish('complete');
  const buildSeconds=((performance.now()-started)/1000).toFixed(2);
  el('build-metrics').textContent='Displayed preview: '+result.triangles.toLocaleString()+' facets · built in '+buildSeconds+' s';
  el('build-metrics').hidden=false;
  status('Preview updated in '+buildSeconds+' s.'+pocketNote);
  updateExportButtons();
  if(reframe)resetCamera();
  try {
    localStorage.setItem('contour-lab-study-v2',JSON.stringify({model:selection.model,rectangles}));
  } catch { status('Preview ready. Use Save recipe to preserve these settings.'); }
  requestContours();
  return true;
}

function strandDimensions(r:RectangleRecipe,z=0) {
  const size=baseSectionSizeAt(r,z);
  return (z===r.height?(r.topSection??r.section):r.section)==='circle'?'Ø '+displayNumber(size.width)+' mm'
    :displayNumber(size.width)+' × '+displayNumber(size.depth)+' mm';
}
function settingsChanged() {
  exportAbort?.abort();
  // Edits invalidate any in-flight result but never launch another build.
  if(building)buildProgress.finish('cancelled');else buildProgress.clear();
  ++generation;buildAbort?.abort();buildAbort=undefined;geometryWorker?.terminate();geometryWorker=undefined;building=false;
  updateRecipeFilename();
  const ready=previewIsCurrent();
  updateExportButtons();
  const message=ready?'Preview is up to date.':'Settings changed — click Build. The preview still shows the previous build.';
  updateBuildButton(message);status(message);
}
el('build').addEventListener('click',()=>void rebuild());
el('cancel-build').addEventListener('click',()=>{
  if(!building||!buildAbort||buildAbort.signal.aborted)return;
  buildAbort.abort();updateBuildButton('Cancelling build…');status('Cancelling build…');
});
function resetCamera() {
  requestRender(true);
  const current=currentRecipe();
  const box=sculpture.geometry.boundingBox;
  const height=box?.max.z || current.height;
  const lightScale=Math.max(100,height);
  key.position.set(-lightScale*0.7,-lightScale,lightScale*1.6);
  Object.assign(key.shadow.camera,{left:-lightScale,right:lightScale,top:lightScale*1.4,bottom:-lightScale,far:lightScale*6});
  key.shadow.camera.updateProjectionMatrix();
  const width=box?Math.hypot(box.max.x-box.min.x,box.max.y-box.min.y):current.diameter;
  const tangent=Math.tan(camera.fov*Math.PI/360);
  const distance=1.2*Math.max(height*1.25/(2*tangent),width/(2*tangent*Math.max(camera.aspect,0.25)));
  controls.target.set(box?(box.min.x+box.max.x)/2:0,box?(box.min.y+box.max.y)/2:0,height*(selection.model==='tree'?0.56:0.43));
  camera.position.copy(controls.target).add(new THREE.Vector3(1.8,-2.6,1.1).normalize().multiplyScalar(distance));
  controls.update();
}
const pane = new Pane({ container: el('controls') });
const rectangleShape=pane.addFolder({title:'01 / Strands & motion',expanded:true});
function editCustomSection(top:boolean) {
  if(building||exporting)return;
  const key=top?'topCustomProfile':'customProfile';
  editStrandPolygon(rectangles[key],top?'Top strand polygon':'Bottom strand polygon',points=>{
    const recipe=validateRectangles({...rectangles,[key]:points});
    Object.assign(rectangles,recipe);pane.refresh();showFolders();settingsChanged();
  });
}
const topShapeOptions={
  get section(){return rectangles.topSection??'same';},
  set section(value:string){rectangles.topSection=value==='same'?undefined:value as RectangleRecipe['section'];},
};
const motionBindings: {binding:{hidden:boolean};modes:RectangleRecipe['motion'][]}[]=[];
const sectionDimensions: {key:string;binding:{hidden:boolean;label:string|null|undefined;element:HTMLElement}}[]=[];
const sectionTaperBindings: {hidden:boolean}[]=[];
function dimension(folder:typeof rectangleShape,key:'count'|'width'|'depth'|'topWidth'|'topDepth'|'orbitTwist'|'twist'|'waveAmplitude'|'waveCycles'|'phaseTurns'|'turnPower'|'waveEndCycles'|'wanderAmplitude'|'wanderBends'|'wanderSeed'|'thicknessAmplitude'|'thicknessCycles',label:string,step:number) {
  const binding=folder.addBinding(rectangles,key,{label,min:rectangleLimits[key][0],max:rectangleLimits[key][1],step});
  binding.element.querySelector('input')?.setAttribute('aria-label',label);
  if(['width','depth','topWidth','topDepth'].includes(key))sectionDimensions.push({key,binding});
  if(key==='topWidth'||key==='topDepth')sectionTaperBindings.push(binding);

  return binding;
}
function parameterHint(folder:typeof rectangleShape,text:string) {
  const hint=document.createElement('p');hint.className='parameter-hint';hint.textContent=text;
  folder.element.querySelector('.tp-fldv_c')!.append(hint);
  return hint;
}
dimension(rectangleShape,'count','Number of strands',1);
rectangleShape.addBinding(rectangles,'strandSpacing',{label:'Strand spacing',options:{'Equal angle':'angle','Equal distance along outline':'perimeter'}})
  .element.querySelector('select')?.setAttribute('aria-label','Strand spacing');
parameterHint(rectangleShape,'Equal distance divides the nominal outline perimeter evenly. Turns and waves then travel along that perimeter: 360° is one circuit. Random offsets can change the spacing.');
const bottomSectionFolder=rectangleShape.addFolder({title:'Strand bottom',expanded:true});
bottomSectionFolder.addBinding(rectangles,'section',{label:'Bottom cross-section',options:{Rectangle:'rectangle',Diamond:'diamond',Triangle:'triangle',Hexagon:'hexagon',Circle:'circle',Ellipse:'ellipse','Custom polygon':'custom'}})
  .element.querySelector('select')?.setAttribute('aria-label','Bottom cross-section');
const bottomPolygonButton=bottomSectionFolder.addButton({title:'Edit bottom polygon…'});
bottomPolygonButton.on('click',()=>editCustomSection(false));
dimension(bottomSectionFolder,'width','Bottom width · mm',.1);
dimension(bottomSectionFolder,'depth','Bottom depth · mm',.5);
const perimeterSizing=bottomSectionFolder.addBinding(rectangles,'scaleWithPerimeter',{label:'Scale with outline perimeter'});
perimeterSizing.element.querySelector('input')?.setAttribute('aria-label','Scale with outline perimeter');
const perimeterSizingHelp=parameterHint(bottomSectionFolder,'Automatic sizing multiplies the bottom dimensions by each level’s perimeter / bottom perimeter. It replaces manual top dimensions and preserves the size-to-spacing ratio, not exact physical overlap.');
const topSectionFolder=rectangleShape.addFolder({title:'Strand top',expanded:true});
const topSectionBinding=topSectionFolder.addBinding(topShapeOptions,'section',{label:'Top cross-section',options:{'Same as bottom':'same',Rectangle:'rectangle',Diamond:'diamond',Triangle:'triangle',Hexagon:'hexagon',Circle:'circle',Ellipse:'ellipse','Custom polygon':'custom'}});
topSectionBinding.element.querySelector('select')?.setAttribute('aria-label','Top cross-section');
const topPolygonButton=topSectionFolder.addButton({title:'Edit top polygon…'});
topPolygonButton.on('click',()=>editCustomSection(true));
const taperToggle=topSectionFolder.addBinding(rectangles,'taperSection',{label:'Set different top dimensions'});
taperToggle.element.querySelector('input')?.setAttribute('aria-label','Set different top dimensions');
dimension(topSectionFolder,'topWidth','Top width · mm',.1);
dimension(topSectionFolder,'topDepth','Top depth · mm',.5);
const sectionTransitionHelp=parameterHint(topSectionFolder,'The cross-section and dimensions blend smoothly from strand bottom to top.');
const strandSidesBinding=rectangleShape.addBinding(rectangles,'sectionSides',{
  label:'Round sides · both ends',min:rectangleLimits.sectionSides[0],max:rectangleLimits.sectionSides[1],step:4,
});
strandSidesBinding.element.querySelector('input')?.setAttribute('aria-label','Round sides · both ends');
strandSidesBinding.element.title='More sides give smoother circular and elliptical strands. Applies to preview and all STL exports; increases build time and mesh size.';
rectangleShape.addBinding(rectangles,'strandPlacement',{label:'Strand centres',options:{'Fit inside outline':'inside','Keep centre paths fixed':'fixed'}})
  .element.querySelector('select')?.setAttribute('aria-label','Strand centres');
parameterHint(rectangleShape,'Fixed centre paths use the bottom strand profile to set the inset at each height. Thickness modulation, perimeter sizing, taper and shape changes then grow around those centres; the surface can extend beyond the outline. Fit inside outline preserves the original placement.');
const thicknessFolder=rectangleShape.addFolder({title:'Thickness modulation',expanded:true});
thicknessFolder.addBinding(rectangles,'thicknessModulation',{label:'Thickness function',options:{Off:'none','Sine wave':'sine','Sine squared · growth only':'sineSquared','Triangle wave':'triangle'}})
  .element.querySelector('select')?.setAttribute('aria-label','Thickness function');
const thicknessBindings=[
  dimension(thicknessFolder,'thicknessAmplitude','Thickness amplitude · ±%',1),
  dimension(thicknessFolder,'thicknessCycles','Thickness waves over height',.25),
  thicknessFolder.addBinding(rectangles,'alternateThickness',{label:'Alternate thickness'}),
];
thicknessBindings[2].element.querySelector('input')?.setAttribute('aria-label','Alternate thickness');
const thicknessHelp=parameterHint(thicknessFolder,'Multiplies both strand dimensions after taper, shape transition and perimeter sizing. ±30% gives 70–130% of the local size. Starts at the base size; alternating strands grow and shrink in opposite phases (even count required). Smooth interior stays smooth.');
const pathFolder=rectangleShape.addFolder({title:'Travel around the outline',expanded:true});
pathFolder.addBinding(rectangles,'motion',{label:'Path motion',options:{'Steady turn':'helix','Sine wave':'sine','Accelerating turn':'accelerating','Changing wavelength':'chirp','Random wandering':'wander','Sharp zigzag':'zigzag'}})
  .element.querySelector('select')?.setAttribute('aria-label','Path motion');
function motionControl(key:Parameters<typeof dimension>[1],label:string,step:number,modes:RectangleRecipe['motion'][]) {
  const binding=dimension(pathFolder,key,label,step);motionBindings.push({binding,modes});return binding;
}
motionControl('orbitTwist','Total turn · °',1,['helix','accelerating']);
motionControl('turnPower','Acceleration · power',1,['accelerating']);
const reverseAccelerationBinding=pathFolder.addBinding(rectangles,'reverseAcceleration',{label:'Fast at bottom, slow at top'});
reverseAccelerationBinding.element.querySelector('input')?.setAttribute('aria-label','Fast at bottom, slow at top');
motionBindings.push({binding:reverseAccelerationBinding,modes:['accelerating']});
motionControl('waveAmplitude','Wave swing · °',.5,['sine','chirp','zigzag']);
const waveCyclesBinding=motionControl('waveCycles','Waves over height',.25,['sine','chirp','zigzag']);
motionControl('waveEndCycles','Top wave frequency',.25,['chirp']);
motionControl('phaseTurns','Phase turns around outline',1,['sine','chirp']);
motionControl('wanderAmplitude','Wander swing · °',.5,['wander']);
motionControl('wanderBends','Wander bends',1,['wander']);
motionControl('wanderSeed','Wander seed',1,['wander']);
const pathHelp=parameterHint(pathFolder,'');
pathFolder.addBinding(rectangles,'alternateOrbit',{label:'Alternate travel direction'})
  .element.querySelector('input')?.setAttribute('aria-label','Alternate travel direction');
const twistFolder=rectangleShape.addFolder({title:'Twist around own axis',expanded:true});
dimension(twistFolder,'twist','Own-axis twist · °',1);
twistFolder.addBinding(rectangles,'randomTwist',{label:'Random own-axis twist'})
  .element.querySelector('input')?.setAttribute('aria-label','Random own-axis twist');
parameterHint(twistFolder,'Random chooses a fixed twist per strand between 0° and the value above. Alternate reverses every second strand.');
twistFolder.addBinding(rectangles,'alternateTwist',{label:'Alternate own-axis twist'})
  .element.querySelector('input')?.setAttribute('aria-label','Alternate own-axis twist');
const randomShape=pane.addFolder({title:'02 / Random strand offsets',expanded:true});
const radialOffsets=randomShape.addFolder({title:'Radial offsets · − in / + out',expanded:true});
const sidewaysOffsets=randomShape.addFolder({title:'Sideways offsets · % of spacing',expanded:true});
// Dynamic level controls read the current recipe. Heights/seeds travel with each
// point through shape edits; only the number of bindings changes on add/remove.
type OffsetBinding=ReturnType<typeof levelOffsets.addBinding>;
const bulgeRandomBindings: {amount:OffsetBinding;seed:OffsetBinding}[]=[];
let rebuildingLevelOffsets=false;
function syncLevelOffsets() {
  if(rebuildingLevelOffsets)return;
  const points=editableBulgePoints(rectangles);
  rebuildingLevelOffsets=true;
  try {
    if(bulgeRandomBindings.length!==points.length) {
      for(const {amount,seed} of bulgeRandomBindings){amount.dispose();seed.dispose();}
      bulgeRandomBindings.length=0;
      points.forEach((_,i)=>{
        const proxy={} as {offset:number;seed:number};
        for(const key of ['offset','seed'] as const)Object.defineProperty(proxy,key,{enumerable:true,
          get:()=>editableBulgePoints(rectangles)[i]?.[key]??0,
          set:(value:number)=>{const latest=editableBulgePoints(rectangles);if(latest[i]&&latest[i][key]!==value){latest[i][key]=value;rectangles.bulgePoints=latest;}}
        });
        const amount=levelOffsets.addBinding(proxy,'offset',{label:'Radial offset · %',min:-80,max:80,keyScale:1,pointerScale:.1,format:displayNumber});
        const seed=levelOffsets.addBinding(proxy,'seed',{label:`Level ${i+1} radial seed`,min:0,max:999999,step:1});
        seed.element.querySelector('input')?.setAttribute('aria-label',`Level ${i+1} radial seed`);
        bulgeRandomBindings.push({amount,seed});
      });
    }
    levelOffsets.hidden=!points.length;
    bulgeRandomBindings.forEach(({amount,seed},i)=>{
      const height=displayNumber(points[i].height*rectangles.height/100);
      amount.label=`Level ${i+1} at ${height} mm · %`;
      amount.element.querySelector('input')?.setAttribute('aria-label',`Level ${i+1} random radial at ${height} mm · %`);
      seed.hidden=!points[i].offset;
    });
  }finally{rebuildingLevelOffsets=false;}
}
const randomBindings=[] as {amount:{hidden:boolean};seed:{hidden:boolean};key:'bottomInset'|'middleInset'|'lowerInset'|'upperInset'|'topInset'|'topTangential'|'bottomTangential';mode:'all'|'single'|'double'}[];
for(const [key,seedKey,label,seedLabel,mode,sideways] of [
  ['bottomInset','bottomInsetSeed','Bottom radial offset · %','Bottom radial seed','all',false],
  ['topInset','insetSeed','Top radial offset · %','Top radial seed','all',false],
  ['bottomTangential','bottomTangentialSeed','Bottom sideways · % spacing','Bottom sideways seed','all',true],
  ['topTangential','topTangentialSeed','Top sideways · % spacing','Top sideways seed','all',true],
] as const){
  const folder=sideways?sidewaysOffsets:radialOffsets;
  const amount=sideways
    ? folder.addBinding(rectangles,key,{label,min:0,max:100,step:1})
    : folder.addBinding({get offset(){return -rectangles[key]||0;},set offset(value:number){rectangles[key]=-value||0;}},'offset',{label,min:-80,max:80,step:1});
  amount.element.querySelector('input')?.setAttribute('aria-label',label);
  const seed=folder.addBinding(rectangles,seedKey,{label:seedLabel,min:0,max:999999,step:1});
  seed.element.querySelector('input')?.setAttribute('aria-label',seedLabel);
  randomBindings.push({amount,seed,key,mode});

}
const levelOffsets=radialOffsets.addFolder({title:'Interior levels',expanded:true,index:2});
const discShape=pane.addFolder({title:'03 / Bottom plate',expanded:true});
discShape.addBinding(rectangles,'bottomDisc',{label:'Add bottom plate'})
  .element.querySelector('input')?.setAttribute('aria-label','Add bottom plate');
const discBindings: {hidden:boolean}[]=[];
for(const [key,label,step] of [['discThickness','Plate thickness · mm',0.5],['discHole','Hole diameter · mm (0 = none)',0.5]] as const) {
  const binding=discShape.addBinding(rectangles,key,{label,min:rectangleLimits[key][0],max:rectangleLimits[key][1],step});
  binding.element.querySelector('input')?.setAttribute('aria-label',label);
  discBindings.push(binding);
}
parameterHint(discShape,'The plate follows the bottom outline and its dimensions.');
const cavityFolder=pane.addFolder({title:'04 / Smooth interior',expanded:false});
const cavityBindings:{hidden:boolean;label:string|null|undefined;element:HTMLElement}[]=[];
const enableCavity=cavityFolder.addBinding(cavityOptions,'enabled',{label:'Enable smooth interior'});
enableCavity.element.querySelector('input')?.setAttribute('aria-label','Enable smooth interior');
for(const [key,label] of [['inset','Cavity radial inset · mm'],['floor','Cavity floor · mm (0 = off)'],['repair','Repair holes with outer fill'],['repairInset','Outer fill inset · mm'],['fillPockets','Fill enclosed wall pockets']] as const){
  const binding=cavityFolder.addBinding(cavityOptions,key,{label,...(key==='repair'||key==='fillPockets'?{}:{format:displayNumber,keyScale:.5,pointerScale:.1})});
  binding.element.querySelector('input')?.setAttribute('aria-label',label);
  cavityBindings.push(binding);
}
const cavityHelp=document.createElement('p');cavityHelp.className='parameter-hint';
enableCavity.element.parentElement!.appendChild(cavityHelp);
function showFolders() {
  bottomPolygonButton.hidden=rectangles.section!=='custom';
  topPolygonButton.hidden=rectangles.topSection!=='custom';
  const thicknessMode=rectangles.thicknessModulation??'none',thicknessOn=thicknessMode!=='none';
  thicknessBindings.forEach(b=>b.hidden=!thicknessOn);
  const thicknessLabel=thicknessMode==='sineSquared'?'Thickness amplitude · +%':'Thickness amplitude · ±%';
  thicknessBindings[0].label=thicknessLabel;
  thicknessBindings[0].element.querySelector('input')?.setAttribute('aria-label',thicknessLabel);
  thicknessHelp.hidden=!thicknessOn;
  thicknessHelp.textContent=(thicknessMode==='sineSquared'
    ?'Growth only: 30% gives 100–130% of the local size. One rounded bulge per wave. Alternating strands use complementary bulges; every second strand starts enlarged. '
    :thicknessMode==='triangle'
    ?'Linear growth and shrinkage with sharp peaks and valleys. ±30% gives 70–130% of the local size; one peak and valley per wave. Alternating strands use the inverse. '
    :'Smooth sine growth and shrinkage. ±30% gives 70–130% of the local size. Starts at base size; alternating strands are 180° apart. ')
    +'Multiplies both dimensions after base sizing and shape transitions. Alternating requires an even strand count. Smooth interior stays smooth.';
  strandSidesBinding.hidden=![rectangles.section,rectangles.topSection].some(s=>s==='circle'||s==='ellipse');
  perimeterSizingHelp.hidden=!rectangles.scaleWithPerimeter;
  if(rectangles.scaleWithPerimeter){const size=baseSectionSizeAt(rectangles,rectangles.height),circle=(rectangles.topSection??rectangles.section)==='circle';
    perimeterSizingHelp.textContent='Sizes follow the nominal perimeter, ignoring random offsets. Calculated top: '+(circle?'diameter '+displayNumber(size.width):displayNumber(size.width)+' × '+displayNumber(size.depth))+' mm. Replaces manual top sizes; exact physical overlap can vary.';
  }
  taperToggle.hidden=!!rectangles.scaleWithPerimeter||hasSectionTransition(rectangles);
  sectionTransitionHelp.hidden=!hasSectionTransition(rectangles);
  sectionTransitionHelp.textContent=rectangles.scaleWithPerimeter?'The cross-section blends toward the top shape. Dimensions are calculated from the bottom sizes and outline perimeter.':'The cross-section and dimensions blend smoothly from strand bottom to top.';
  cavityBindings.forEach((b,i)=>b.hidden=!cavityOptions.enabled||(i===3&&!cavityOptions.repair));
  cavityHelp.hidden=!cavityOptions.enabled;
  const scaledCavity=!!rectangles.scaleWithPerimeter;
  for(const [index,label] of [[0,scaledCavity?'Bottom cavity inset · mm':'Cavity radial inset · mm'],[3,scaledCavity?'Bottom outer fill inset · mm':'Outer fill inset · mm']] as const){
    cavityBindings[index].label=label;
    cavityBindings[index].element.querySelector('input')?.setAttribute('aria-label',label);
  }
  const topScale=strandPerimeterScaleAt(rectangles,rectangles.height);
  cavityHelp.textContent=(scaledCavity?'Both inset values apply at the bottom and scale with the outline perimeter at every height. Calculated top: cavity '+displayNumber(cavityOptions.inset*topScale)+' mm'+(cavityOptions.repair?', outer fill '+displayNumber(cavityOptions.repairInset*topScale)+' mm':'')+'. Floor and plate thicknesses stay fixed. ':'')
    +'Bottom 0 = no cavity floor; preserves any bottom plate and hole. Insets are radial, not perpendicular wall thickness. Fill enclosed wall pockets removes sealed voids only; openings to the outside stay open.'
    +(cavityOptions.repair?' '+(scaledCavity?'Bottom radial allowance: ':'Radial allowance: ')+displayNumber(cavityOptions.inset-cavityOptions.repairInset)+' mm.'+(scaledCavity?' This allowance scales with the outline perimeter.':'')+' Outer fill can change deep valleys.':'');
  syncLevelOffsets();
  for(const binding of randomBindings){
    binding.amount.hidden=false;
    binding.seed.hidden=binding.amount.hidden||rectangles[binding.key]===0;
  }
  for(const binding of sectionTaperBindings)binding.hidden=!!rectangles.scaleWithPerimeter||(!rectangles.taperSection&&!hasSectionTransition(rectangles));
  for(const {key,binding} of sectionDimensions) {
    const top=key.startsWith('top'),depth=key==='depth'||key==='topDepth';
    const shape=top?(rectangles.topSection??rectangles.section):rectangles.section;
    const circle=shape==='circle',ellipse=shape==='ellipse';
    binding.hidden=(top&&(!!rectangles.scaleWithPerimeter||(!rectangles.taperSection&&!hasSectionTransition(rectangles))))||(circle&&depth);
    binding.label=(top?'Top ':'Bottom ')+(circle?'diameter':ellipse?(depth?'length':'thickness'):(depth?'radial depth':'width'))+' · mm';
    binding.element.querySelector('input')?.setAttribute('aria-label',binding.label);
  }
  discShape.hidden=selection.model!=='rectangles';
  for(const binding of discBindings)binding.hidden=!rectangles.bottomDisc;
  for(const {binding,modes} of motionBindings)binding.hidden=!modes.includes(rectangles.motion);
  const waveLabel=rectangles.motion==='chirp'?'Bottom wave frequency':'Waves over height';
  waveCyclesBinding.label=waveLabel;
  waveCyclesBinding.element.querySelector('input')?.setAttribute('aria-label',waveLabel);
  const motionHelp:Record<RectangleRecipe['motion'],string>={
    helix:'', sine:'',
    accelerating:'Power 1 is steady; higher powers concentrate the turn near the top. Reverse to concentrate it near the bottom.',
    chirp:'Frequency is waves per total height: higher means shorter waves. It changes smoothly from bottom to top.',
    wander:'Each strand follows its own seeded smooth path. More bends give shorter waves. Both endpoints stay fixed; radial and sideways offsets still apply.',
    zigzag:'Straight angular ramps with sharp reversals. Turning heights are preserved in preview and STL. All strands share the turning heights; alternate direction mirrors every second strand.',
  };
  pathHelp.textContent=motionHelp[rectangles.motion];pathHelp.hidden=!pathHelp.textContent;
}
setupRecipeLayout([rectangleShape,randomShape,discShape,cavityFolder]);
setupSilhouetteEditor({
  getRecipe:()=>rectangles,
  apply:recipe=>{
    Object.assign(rectangles,recipe);pane.refresh();showFolders();settingsChanged();
  },
  structure:()=>el<HTMLButtonElement>('expand-recipe').click(),
  build:()=>{
    const dialog=el<HTMLDialogElement>('recipe-dialog');if(dialog.open)dialog.close();
    el<HTMLButtonElement>('build').click();
  },
});
showFolders();
pane.on('change', () => {commitCavityOptions();showFolders();settingsChanged();});
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    viewMode = button.dataset.mode!;
    sculpture.visible = viewMode !== 'contours';
    contours.visible = viewMode !== 'solid';
    requestRender(true);
    requestContours();
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  });
});
contours.visible = false;
layer.addEventListener('input', updateSlice);
showLayerInspector.addEventListener('change',()=>{
  updateSlice();
  try { localStorage.setItem('contour-lab-layer-inspector',String(showLayerInspector.checked)); }
  catch { /* The toggle still works for this session. */ }
});
updateSlice();
el('reset-camera').addEventListener('click', resetCamera);
el('rotate').addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  lastFrameTime=0;requestRender();
  el('rotate').setAttribute('aria-pressed', String(controls.autoRotate));
});
function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function setRecipeIO(busy:boolean){
  recipeIOBusy=busy;
  for(const id of ['save','save-as','load'])el<HTMLButtonElement>(id).disabled=busy;
  el<HTMLButtonElement>('clear').disabled=busy||building||exporting;
}
async function saveRecipe(saveAs=false){
  if(recipeIOBusy)return;
  const model=selection.model,current=structuredClone(currentRecipe());
  const suggestedName=`${namedRecipe?.base||recipeName()}.json`;
  const data=new Blob([JSON.stringify({format:'contour-lab',version:3,model,units:'mm',recipe:current},null,2)],{type:'application/json'});
  setRecipeIO(true);
  try {
    if(recipePickers.showSaveFilePicker){
      // Call directly from the click: native pickers require user activation.
      const filename=await recipeFiles.save(recipePickers,data,suggestedName,saveAs);
      rememberRecipeName(filename,model,current);
      status(`Recipe saved as ${filename}. Save will update this same file; use Save as… for a separate copy.`);
    }else{
      const filename=await askFilename({
        title:'Download recipe',suggestedName,action:'Download',
        hint:'This browser cannot overwrite local files. Downloads may receive a numbered suffix. Open Contour Lab in desktop Chrome or Edge for Save and Save as. This name also carries over to STL exports.',
        validate:value=>{
          const stem=value.trim().replace(/\.json$/i,'');
          return validSTLName(stem+'.stl').replace(/\.stl$/i,'.json');
        }
      });
      if(filename===null){status('Recipe save cancelled.');return;}
      download(data,filename);
      rememberRecipeName(filename,model,current);
      status(`Recipe download requested as ${filename}. This browser may add a numbered suffix; the original file was not overwritten.`);
    }
  } catch(error) {
    status((error as Error).name==='AbortError'?'Recipe save cancelled.':`Could not save recipe: ${(error as Error).message}. Use Save as… to choose a writable file.`);
  } finally {setRecipeIO(false);}
}
el('save').addEventListener('click',()=>void saveRecipe());
el('save-as').addEventListener('click',()=>void saveRecipe(true));
el('save').title=recipePickers.showSaveFilePicker?'Update the current recipe file; choose a location on first save':'Download recipe (this browser cannot overwrite files)';
el('clear').addEventListener('click',()=>{
  if(building||exporting||recipeIOBusy)return;
  recipeFiles.use(undefined);showRecipeMigration(null);
  // Remove optional values as well as resetting defaults; bindings keep this object.
  for(const key of Object.keys(rectangles))delete (rectangles as unknown as Record<string,unknown>)[key];
  Object.assign(rectangles,structuredClone(rectangleDefaults));
  Object.assign(cavityOptions,{enabled:false,inset:3,floor:2,repair:false,repairInset:0,fillPockets:false});
  namedRecipe=undefined;cachedRectangleBase=undefined;solidExport.checked=false;
  try {localStorage.removeItem('contour-lab-named-recipe');localStorage.removeItem('contour-lab-study-v2');}catch { /* Session-only reset still works. */ }
  el<HTMLInputElement>('stl-step').value=displayNumber(rectangles.layerHeight);
  pane.refresh();showFolders();settingsChanged();
  void rebuild();
});
async function loadRecipeFile(file:File,handle?:OpenRecipeHandle){
  if (file.size > MAX_RECIPE_FILE_BYTES) throw new Error('Recipe file is too large (maximum 1 MB).');
  const json = JSON.parse(await file.text());
  if (json.format !== 'contour-lab' || ![1,2,3].includes(json.version) || json.units !== 'mm') throw new Error('Unsupported recipe format.');
  if(json.version!==3||json.model!=='rectangles')throw new Error('This app loads strand recipes only. Tree and tower models are no longer supported.');
  const validated=validateRectangles(json.recipe);
  Object.assign(rectangles,validated);restoreCavityOptions();
  el<HTMLInputElement>('stl-step').value=displayNumber(rectangles.layerHeight);
  pane.refresh();showFolders();settingsChanged();
  recipeFiles.use(handle);showRecipeMigration(json.recipe);
  rememberRecipeName(file.name,selection.model,currentRecipe());
  status('Recipe loaded — click Build to update the preview.');
}
el('load').addEventListener('click',async()=>{
  if(recipeIOBusy)return;
  if(!recipePickers.showOpenFilePicker){el<HTMLInputElement>('recipe-file').click();return;}
  setRecipeIO(true);
  try{
    const [handle]=await recipePickers.showOpenFilePicker({...recipePickerOptions,multiple:false});
    if(handle)await loadRecipeFile(await handle.getFile(),handle);
  }catch(error){status((error as Error).name==='AbortError'?'Recipe load cancelled.':`Could not load recipe: ${(error as Error).message}`);}
  finally{setRecipeIO(false);}
});
el<HTMLInputElement>('recipe-file').addEventListener('change',async event=>{
  const input=event.target as HTMLInputElement;
  if(recipeIOBusy){input.value='';return;}
  setRecipeIO(true);
  try{const file=input.files?.[0];if(file)await loadRecipeFile(file);}
  catch(error){status(`Could not load recipe: ${(error as Error).message}`);}
  finally{input.value='';setRecipeIO(false);}
});
async function downloadSTL(mode:'full'|'lightweight'|'reduced'|'smooth-wall'='full') {
  const lightweight=mode==='lightweight',reduced=mode==='reduced',smoothWall=mode==='smooth-wall';
  if(exporting || building || !previewIsCurrent())return;
  const model=displayedModel,current={...JSON.parse(displayedRecipe),layerHeight:rectangles.layerHeight} as RectangleRecipe;
  const solidBody=!smoothWall&&model==='rectangles'&&solidExport.checked;
  const exportName=await askFilename({
    title:smoothWall?'Export smooth wall STL':lightweight?'Export lightweight STL':reduced?'Export reduced STL':'Export full STL',
    suggestedName:smoothWall?suggestSmoothWallName(current,namedRecipe?.base):suggestSTLName(current,lightweight,solidBody,namedRecipe?.base,reduced),
    action:'Export',
    hint:smoothWall?'Import this STL as a modifier on the main model, keeping its original position. Edit the filename below.':'Edit the name before export starts. Files go to your browser’s download location.',
    validate:validSTLName
  });
  if(exportName===null)return;
  el('build-error').hidden=true;
  exporting=true;
  exportAbort = new AbortController();
  const signal = exportAbort.signal;
  updateBuildButton(smoothWall?'Preparing smooth wall modifier…':lightweight?'Preparing lightweight STL…':'Preparing full-resolution STL…');
  updateExportButtons();
  status(smoothWall?'Building the smooth wall modifier…':lightweight?'Saving the displayed preview as a lightweight STL…':'Building full-resolution STL…');
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    signal.throwIfAborted();
    let data: DataView, overhang:number|undefined, reductionText='';
    if(lightweight&&solidBody) {
      const worker=new Worker(new URL('./rectangles.worker.ts',import.meta.url),{type:'module'});
      const result=await buildGeometry<LatticeResult>(current as RectangleRecipe,'preview',worker,signal,{solidBody,
        mesh:{positions:sculpture.geometry.getAttribute('position').array,indices:sculpture.geometry.getIndex()!.array}});
      try {data=geometrySTL(result.geometry);}finally{result.geometry.dispose();}
    } else if(lightweight) {
      // Serialize only the displayed sculpture; overlays, slices and scene helpers are excluded.
      data=geometrySTL(sculpture.geometry);
    } else if(model==='rectangles') {
      const worker=new Worker(new URL('./rectangles.worker.ts',import.meta.url),{type:'module'});
      const result=await buildGeometry<LatticeResult>(current as RectangleRecipe,'export',worker,signal,{solidBody,...(smoothWall?{operation:'smooth-wall'}:{})});
      try { data=geometrySTL(result.geometry); } finally { result.geometry.dispose(); }
    }
    else throw new Error("Unsupported model.");
    signal.throwIfAborted();
    if(reduced) {
      status('Reducing full-detail STL toward one-third of its faces and checking seams…');
      updateBuildButton('Reducing full-detail STL…');
      const result=await reduceSTL(data,signal);
      data=result.data;
      const m=result.metrics;
      reductionText=` · ${m.originalTriangles.toLocaleString()} → ${m.triangles.toLocaleString()} faces (${Math.round(100*(1-m.triangles/m.originalTriangles))}% fewer) · reduction ${m.seconds.toFixed(1)} s`;
    }
    signal.throwIfAborted();
    download(new Blob([new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)], { type: 'model/stl' }), exportName);
    const faceCount=data.getUint32(80,true);
    el('last-export').hidden=false;
    el('last-export').textContent=`Last exported STL: ${exportName} · ${smoothWall?'smooth wall modifier':lightweight?'preview detail':reduced?'reduced full detail':'full detail'} · ${faceCount.toLocaleString()} faces · ${(data.byteLength / 1e6).toFixed(1)} MB${reductionText}. This records the last export; later edits may differ.`;
    status(`${smoothWall?'Smooth wall modifier STL':lightweight?'Lightweight STL':reduced?'Reduced STL':'STL'} exported · ${faceCount.toLocaleString()} faces · ${(data.byteLength / 1e6).toFixed(1)} MB${overhang!==undefined?` · ${overhang.toFixed(2)}° maximum overhang`:''}${reductionText} · import in millimetres.`);
  } catch (error) {
    if(!signal.aborted)showError('Export failed: '+(error as Error).message);
    status(signal.aborted ? 'Export cancelled because settings changed — click Build.' : `Export failed: ${(error as Error).message}`);
  }
  finally {
    exporting=false; exportAbort=undefined; updateExportButtons();
    updateBuildButton(previewIsCurrent() ? 'Preview is up to date.' : 'Settings changed — click Build.');
  }
}
el('export').addEventListener('click',()=>void downloadSTL());
el('export-lightweight').addEventListener('click',()=>void downloadSTL('lightweight'));
el('export-reduced').addEventListener('click',()=>void downloadSTL('reduced'));
el('export-smooth-wall').addEventListener('click',()=>void downloadSTL('smooth-wall'));
new ResizeObserver(() => {
  const { clientWidth: width, clientHeight: height } = viewport;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  requestRender();
  if(sculpture.geometry.boundingBox)resetCamera();
}).observe(viewport);
previewDetailPicker.addEventListener('change',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement)||!input.checked)return;
  previewDetail=parsePreviewDetail(input.value);
  try {localStorage.setItem('contour-lab-preview-detail',String(previewDetail));}catch { /* Session setting still works. */ }
  settingsChanged();
});
const stlStep=el<HTMLInputElement>('stl-step');
stlStep.value=displayNumber(rectangles.layerHeight);
stlStep.addEventListener('input',()=>{
  if(stlStep.checkValidity()&&Number.isFinite(stlStep.valueAsNumber)){
    rectangles.layerHeight=stlStep.valueAsNumber;
    updateRecipeFilename();
    if(previewIsCurrent())el('export-note').textContent='Full STL step '+displayNumber(rectangles.layerHeight)+' mm. Z up; all dimensions in millimetres.';
    el('stl-step-note').textContent='Full STL only. Larger steps reduce detail and file size. No preview rebuild needed.';
  }else el('stl-step-note').textContent='Enter an STL step from 0.1 to 1 mm.';
  updateExportButtons();
});

void rebuild().then(resetCamera);
requestRender(true);



