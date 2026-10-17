import {centerAt} from './centreline.ts';
import {adaptiveStations} from './adaptive-sampling.ts';
import type {ProgressCallback} from './build-progress.ts';
import {nativeUnion} from './native-union.ts';
import type {PreviewDetail} from './preview-settings.ts';
import Module from 'manifold-3d';
import type {ManifoldToplevel,Manifold} from 'manifold-3d';
import {BufferGeometry,BufferAttribute} from 'three';
import {outlinePolygon,validateRectangles,hasOutlineTransition,strandPerimeterScaleAt} from './rectangles.ts';
import type {RectangleRecipe,RectangleQuality} from './rectangles.ts';
import {outerSolid} from './outer-solid.ts';
import {fillEnclosedPockets} from './fill-enclosed-pockets.ts';
import {cavityFailure} from './cavity-errors.ts';
import type {CavityStage} from './cavity-errors.ts';
import {inspectRectangleMesh,assertConnectedRectangleSolid,LatticeSeamError,LatticeContactError,resolveLatticeContacts,weldCollapsedLatticeSliver} from './rectangle-union.ts';

/** Insets use the same bottom-relative scale as strands. The clearance guard's
 * outward expansion stays absolute, independent of proportional sizing. */
export function cavityContour(recipe:RectangleRecipe,z:number,inset:number,segments:number,radialExpansion=0) {
  inset=inset*strandPerimeterScaleAt(recipe,z)-radialExpansion;
  const ring=outlinePolygon(recipe,z,segments);
  const sampled=!hasOutlineTransition(recipe)&&ring.length===512?ring.filter((_,i)=>i%(512/segments)===0):ring;
  const center=centerAt(recipe,z);
  return sampled.map(([x,y])=>{
    const radius=Math.hypot(x,y);
    if(radius-inset<0.5)throw new Error('The cavity closes near the centre. Decrease Smooth interior > Radial inset, or enlarge the outline/bulge profile.');
    const scale=(radius-inset)/radius;
    return [x*scale+center.x,y*scale+center.y] as [number,number];
  });
}

function coreMesh(recipe:RectangleRecipe,quality:RectangleQuality,step:number,inset:number,top:number,
  floor=recipe.smoothCavity!.floor,extraKnots:number[]=[],previewDetail:PreviewDetail=1,radialExpansion=0) {
  const segments=quality==='export'?512:128*previewDetail;
  const knots=[floor,...extraKnots,...(recipe.bulgePoints?.map(p=>p.height/100*recipe.height)
    ?? (recipe.twoBulges?[recipe.height/3,2*recipe.height/3]:[recipe.height/2])),top]
    .filter(z=>z>=floor && z<=top).sort((a,b)=>a-b);
  let stations=[floor];
  if(quality==='export')for(const end of knots) {
    const start=stations[stations.length-1];if(end-start<1e-6)continue;
    const n=Math.ceil((end-start)/step);
    for(let j=1;j<=n;j++)stations.push(start+(end-start)*j/n);
  }
  if(quality==='preview') {
    // Smooth surfaces have their own curvature, independent of strand crossings.
    stations=adaptiveStations([...new Set(knots)],2/previewDetail,.1,.03/(previewDetail*previewDetail),
      z=>cavityContour(recipe,z,inset,segments,radialExpansion));
  }
  const p:number[]=[],idx:number[]=[];
  const count=cavityContour(recipe,floor,inset,segments,radialExpansion).length;
  for(const z of stations)for(const [x,y] of cavityContour(recipe,z,inset,segments,radialExpansion))p.push(x,y,z);
  for(let j=0;j<stations.length-1;j++)for(let i=0;i<count;i++) {
    const a=j*count+i,b=j*count+(i+1)%count,c=b+count,d=a+count;
    idx.push(a,b,c,a,c,d);
  }
  for(const [row,z,up] of [[0,floor,false],[stations.length-1,top,true]] as const) {
    const centre=p.length/3,shift=centerAt(recipe,z);p.push(shift.x,shift.y,z);
    for(let i=0;i<count;i++) {
      const a=row*count+i,b=row*count+(i+1)%count;
      if(up)idx.push(centre,a,b);else idx.push(centre,b,a);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(p),3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(idx),1));
  return geometry;
}

/** Optionally unite a larger smooth fill directly with the original lattice,
 * otherwise preserve the existing continuous outer wall. Then cut the cavity.
 * A slightly larger guard core must fit inside the actual repaired outside.
 * Failed operations leave the caller's original geometry untouched. */
export async function smoothCavity(source:BufferGeometry,input:RectangleRecipe,quality:RectangleQuality,
  sampleStep:number,runtime?:ManifoldToplevel,progress:ProgressCallback=()=>{},previewDetail:PreviewDetail=1) {
  const recipe=validateRectangles(input),options=recipe.smoothCavity;
  if(!options)throw new Error('Choose smooth cavity settings first.');
  const wasm=runtime??await Module();if(!runtime)wasm.setup();
  const repairing=options.repairInset!==undefined;
  const noFloor=options.floor===0;
  const preservePlate=noFloor&&recipe.bottomDisc;
  const cavityStart=preservePlate?recipe.discThickness:options.floor;
  const solids=new Set<Manifold>(),geometries:BufferGeometry[]=[];
  const release=(solid:Manifold)=>{if(solids.delete(solid))solid.delete();};
  let failure:unknown;
  const toSolid=(g:BufferGeometry)=>{
    const solid=new wasm.Manifold(new wasm.Mesh({numProp:3,
      vertProperties:g.getAttribute('position').array as Float32Array,
      triVerts:new Uint32Array(g.getIndex()!.array)}));solids.add(solid);
    if(solid.status()!=='NoError')throw new Error('The cavity input did not form a valid closed solid.');
    return solid;
  };
  let stage:CavityStage='preparing the body';
  let clearancePassed=false;
  try {
    source.computeBoundingBox();
    const top=source.boundingBox!.max.z;
    const step=Math.min(sampleStep||recipe.layerHeight,quality==='export'?.5:2);
    let body:Manifold;
    if(repairing) {
      stage='adding the outer repair fill';
      progress('Adding the larger smooth fill to repair holes and deep valleys…');
      const fillMesh=coreMesh(recipe,quality,step,options.repairInset!,top,0,[cavityStart],previewDetail);geometries.push(fillMesh);
      const original=toSolid(source),fill=toSolid(fillMesh);
      body=original.add(fill);solids.add(body);
      if(body.status()!=='NoError')throw new Error('The outer repair fill could not be joined to the sculpture.');
      release(original);release(fill);
    } else {
      let filled;
      try {filled=outerSolid(source,progress);}
      catch(error) {
        if((error as Error).message.startsWith('Solid-body export'))
          throw new Error('Smooth interior needs a continuous outer wall. Enable Repair holes with outer fill, or adjust the strands to close gaps.');
        throw error;
      }
      geometries.push(filled.geometry);
      body=toSolid(filled.geometry);
    }
    stage='checking wall clearance';
    progress('Checking the smooth cavity against the outer valleys…');
    // This is horizontal clearance, not a promise of normal wall thickness.
    const guardMesh=coreMesh(recipe,quality,step,options.inset,top,cavityStart,[],previewDetail,.25);geometries.push(guardMesh);
    const guard=toSolid(guardMesh),outside=guard.subtract(body);solids.add(outside);
    if(!outside.isEmpty())throw new Error('The smooth cavity is too close to, or breaks through, an outer valley. Increase Smooth interior > Radial inset to make the cavity smaller. If you want to keep its size, enable Repair holes with outer fill (or decrease Outer fill inset if already enabled) to fill valleys farther outward. At least 0.25 mm radial clearance is required.');
    release(outside);release(guard);
    clearancePassed=true;
    stage='cutting the interior';
    progress('Cutting the smooth interior and checking the vase…');
    const cutterMesh=coreMesh(recipe,quality,step,options.inset,top,preservePlate?0:cavityStart,[cavityStart],previewDetail);geometries.push(cutterMesh);
    const cutter=toSolid(cutterMesh);
    // Cut through the clipped wall, rather than trimming a cavity exactly
    // at its floor: coincident caps can otherwise leave zero-thickness sheets.
    const wallBody=preservePlate?body.trimByPlane([0,0,1],recipe.discThickness):body;
    if(wallBody!==body)solids.add(wallBody);
    let cut=wallBody.subtract(cutter);solids.add(cut);
    if(cut.status()!=='NoError')throw new Error('The cavity subtraction did not form a valid closed solid.');
    release(cutter);release(wallBody);if(body!==wallBody)release(body);
    if(preservePlate) {
      stage='restoring the bottom plate and centre hole';
      progress('Preserving the original bottom plate and centre hole…');
      // Restore the complete original material below the plate top. This also
      // prevents the optional outer repair fill from changing the plate outline.
      const original=toSolid(source);
      const plate=original.trimByPlane([0,0,-1],-recipe.discThickness);
      solids.add(plate);
      const previousCut=cut;
      cut=cut.add(plate);solids.add(cut);
      if(cut.status()!=='NoError')throw new Error('The bottom plate could not be restored as a closed solid.');
      release(previousCut);release(plate);release(original);
    }
    stage='checking the finished cavity mesh';
    progress('Cleaning the finished smooth-interior surface…',{phase:'interior'});
    // Boolean junctions can coincide only after Float32 export. Resolve that
    // rounding in the kernel before validating the exact STL coordinates.
    let final=cut;
    if(repairing||preservePlate) {
      const cutMesh=cut.getMesh();release(cut);
      const rounded=new wasm.Manifold(cutMesh);solids.add(rounded);
      let clean:Manifold;
      if(quality==='export'&&rounded.numTri()>1_000_000) {
        progress('Cleaning the large smooth-interior mesh with the native engine…');
        const inputs=[rounded];solids.delete(rounded);
        try {clean=await nativeUnion(inputs,wasm,false,progress,quality,{consumeInputs:true});}
        finally {while(inputs.length)inputs.pop()!.delete();}
      } else clean=rounded.simplify(.001);
      solids.add(clean);
      if(clean.status()!=='NoError')throw new Error('The cavity cleanup did not form a valid closed solid.');
      release(rounded);
      const cleanMesh=clean.getMesh();release(clean);
      final=new wasm.Manifold(cleanMesh);solids.add(final);
      if(final.status()!=='NoError')throw new Error('The cavity could not be represented as a closed export mesh.');
    }
    let filledPockets:number|undefined,filledVolume:number|undefined;
    if(options.fillPockets) {
      stage='filling enclosed wall pockets';
      progress('Filling enclosed pockets between the inner and outer surfaces…');
      const filled=fillEnclosedPockets(final,wasm,progress);
      if(filled.solid!==final){solids.add(filled.solid);release(final);}
      final=filled.solid;filledPockets=filled.filledPockets;filledVolume=filled.filledVolume;
      stage='checking the finished cavity mesh';
    }
    progress('Validating the finished surface…',{phase:'checks'});
    let contactRepairs=0,sliverRepairs=0;
    for(;;) {
    const mesh=final.getMesh(),geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(mesh.vertProperties.slice(),3));
    geometry.setIndex(new BufferAttribute(mesh.triVerts.slice(),1));
    try {
      const audit=inspectRectangleMesh(geometry,progress);
      if(noFloor&&!repairing) {
        const expectedEuler=recipe.bottomDisc&&recipe.discHole===0?2:0;
        if(audit.components!==1||audit.euler!==expectedEuler)
          throw new Error('The floor-free cavity did not leave one clean connected wall. Adjust its inset or bottom plate.');
      }
      if(repairing||noFloor) {
        // Exterior ornamental handles and enclosed voids do not break the
        // protected inner shell, but disconnected positive-volume pieces do.
        try {assertConnectedRectangleSolid(final,progress);}
        catch {throw new Error(repairing?'The repair fill did not connect every piece. Decrease the outer fill inset to reach farther outward.':'The smooth cavity did not leave one connected body. Adjust its inset or the bottom plate.');}
      } else if(audit.components!==1||audit.euler!==2)throw new Error('The smooth cavity did not leave one closed vase body. Increase the inset or bottom thickness.');
      geometry.computeVertexNormals();geometry.computeBoundingBox();
      return {geometry,...audit,filledPockets,filledVolume};
    } catch(error) {
      geometry.dispose();
      // Cavity booleans can round microscopic edges to collinear Float32
      // triangles, just like strand fusion. Weld only the existing bounded
      // 0.0001 mm sliver cases; never remove arbitrary faces or skip auditing.
      if(error instanceof Error && error.message.includes('collapsed triangle') && sliverRepairs<2) {
        const repaired=weldCollapsedLatticeSliver(mesh.vertProperties,mesh.triVerts);
        sliverRepairs++;
        progress(repaired?'Repairing microscopic smooth-interior slivers…':'Retriangulating collinear smooth-interior faces…');
        // A flat cap can also have a long, exactly collinear face: no tiny
        // edge may be welded. Zero-tolerance simplification removes redundant
        // planar triangulation instead of moving its long-span vertices.
        // Rebuild from XYZ/indices only: source face IDs otherwise protect
        // artificial cap edges from simplification, including this zero-area
        // triangle. The fresh mesh preserves the exact serialized geometry.
        const input=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:repaired??mesh.vertProperties,triVerts:mesh.triVerts}));
        solids.add(input);
        if(input.status()!=='NoError')throw new Error('Smooth-interior precision input could not form a closed solid.');
        const healed=repaired?input:input.simplify(0);
        solids.add(healed);if(healed!==input)release(input);
        if(healed.status()!=='NoError')throw new Error('Smooth-interior precision repair could not form a closed solid.');
        // Audit healed.getMesh() directly on the next pass. getMesh already
        // returns the Float32 coordinates serialized to STL;
        // the full mesh and connectivity checks below remain mandatory.
        release(final);final=healed;
        continue;
      }
      // Separate budgets: repairing a sliver must not consume contact retries.
      // A cavity boolean can leave a longer exact four-face touching edge.
      // The repair's displacement is bounded by its pin radius, not edge length.
      // Only balanced four-face contacts qualify; holes/wrong winding still fail.
      const contacts=error instanceof LatticeContactError?error.contacts
        :error instanceof LatticeSeamError?error.touchingContacts:undefined;
      if(!contacts?.length||contacts.length>64||contactRepairs>=2)throw error;
      contactRepairs++;
      progress('Resolving microscopic smooth-interior contact edges…');
      const healed=resolveLatticeContacts(final,contacts,wasm);solids.add(healed);
      if(healed.status()!=='NoError')throw new Error('Smooth-interior contact repair failed.');
      const rounded=new wasm.Manifold(healed.getMesh());solids.add(rounded);
      if(rounded.status()!=='NoError')throw new Error('Smooth-interior contact repair could not form a closed export mesh.');
      release(final);release(healed);final=rounded;
    }
    }
  } catch(error) {
    failure=error;
    throw cavityFailure(error,recipe,stage,clearancePassed,error instanceof LatticeSeamError
      || (error instanceof Error && error.message.includes('collapsed triangle')));
  } finally {
    // An exhausted WASM heap may also fail during deletion. Preserve the
    // original stage/cause rather than replacing it with a destructor trap.
    let cleanupError:unknown;
    for(const solid of solids)try{solid.delete();}catch(error){cleanupError??=error;}
    for(const geometry of geometries)geometry.dispose();
    if(!failure&&cleanupError)throw cleanupError;
  }
}

/** Standalone modifier in the sculpture coordinate system. Reuse the exact
 * full-export fill/cutter grids, without generating or fusing any strands.
 * A disabled cavity floor excludes the independent bottom plate. */
export async function smoothWallModifier(input:RectangleRecipe,runtime?:ManifoldToplevel,
  progress:ProgressCallback=()=>{}) {
  const recipe=validateRectangles(input),options=recipe.smoothCavity;
  if(!options||options.repairInset===undefined)
    throw new Error('Smooth wall export needs Enable smooth interior and Repair holes with outer fill in 05 / Smooth interior. Build those settings first.');
  const wasm=runtime??await Module();if(!runtime)wasm.setup();
  const preservePlate=options.floor===0&&recipe.bottomDisc;
  const cavityStart=preservePlate?recipe.discThickness:options.floor;
  const step=Math.min(recipe.layerHeight,.5);
  const geometries:BufferGeometry[]=[],solids:Manifold[]=[];
  const toSolid=(g:BufferGeometry)=>{
    geometries.push(g);
    const solid=new wasm.Manifold(new wasm.Mesh({numProp:3,
      vertProperties:g.getAttribute('position').array as Float32Array,
      triVerts:new Uint32Array(g.getIndex()!.array)}));solids.push(solid);
    if(solid.status()!=='NoError')throw new Error('A smooth surface could not form a closed solid. Check the outline, bulges and cavity insets.');
    return solid;
  };
  try {
    progress('Building the smooth wall modifier from the inner and outer surfaces…');
    let outer=toSolid(coreMesh(recipe,'export',step,options.repairInset,recipe.height,0,[cavityStart]));
    const inner=toSolid(coreMesh(recipe,'export',step,options.inset,recipe.height,
      preservePlate?0:cavityStart,[cavityStart]));
    if(preservePlate){outer=outer.trimByPlane([0,0,1],recipe.discThickness);solids.push(outer);}
    const wall=outer.subtract(inner);solids.push(wall);
    if(wall.status()!=='NoError'||wall.isEmpty())throw new Error('The two smooth surfaces did not leave a closed wall. Check the cavity and outer fill insets.');
    const mesh=wall.getMesh(),geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(mesh.vertProperties.slice(),3));
    geometry.setIndex(new BufferAttribute(mesh.triVerts.slice(),1));
    try {
      const audit=inspectRectangleMesh(geometry,progress);
      if(audit.components!==1||audit.euler!==(options.floor===0?0:2))
        throw new Error('The smooth wall is not one continuous vase shell. Check the outline and bulge settings.');
      geometry.computeVertexNormals();geometry.computeBoundingBox();
      return {geometry,...audit,lines:new Float32Array(),sampleStep:step};
    } catch(error){geometry.dispose();throw error;}
  } catch(error) {
    throw new Error('Smooth wall modifier: '+(error as Error).message);
  } finally {
    for(const solid of solids)solid.delete();
    for(const geometry of geometries)geometry.dispose();
  }
}
