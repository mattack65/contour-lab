import {centerAt} from './centreline.ts';
import type {ProgressCallback} from './build-progress.ts';
import {nativeUnion} from './native-union.ts';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { BufferGeometry, BufferAttribute } from 'three';
import { generateRectangles, validateRectangles, outlinePolygon } from './rectangles.ts';
import type { RectangleRecipe, RectangleQuality } from './rectangles.ts';

type Point3 = [number,number,number];
type ContactEdge = [Point3,Point3];

/** A valid kernel solid can have several boundary shells: enclosed cavities
 * have negative signed volume and do not represent detached material. */
export function assertConnectedRectangleSolid(solid: Manifold,progress?:ProgressCallback): void {
  progress?.('Finding connected material…',{phase:'checks'});
  const shells=solid.decompose();
  try {
    let completed=0;
    progress?.('Checking connected material…',{phase:'checks',completed,total:shells.length,unit:'shells'});
    const bodies: Manifold[]=[];
    for(const shell of shells) {
      const volume=shell.volume();
      if(!Number.isFinite(volume)||volume===0)throw new Error('The lattice has an invalid zero-volume boundary.');
      if(volume>0)bodies.push(shell);
      completed++;
      if(completed%16===0||completed===shells.length)progress?.('Checking connected material…',{phase:'checks',completed,total:shells.length,unit:'shells'});
    }
    if(bodies.length!==1) {
      const contacts=pointAttachedFragments(shells,bodies);
      if(contacts)throw new LatticeFragmentError(contacts);
      throw new Error('The bottom disc did not connect every plank into one solid.');
    }
  } finally {for(const shell of shells)shell.delete();}
}

export class LatticeSeamError extends Error {
  readonly touchingContacts?:ContactEdge[];
  constructor(touchingContacts?:ContactEdge[]) {super('The lattice has an open or inconsistently wound seam.');this.touchingContacts=touchingContacts;}
}

export class LatticeContactError extends LatticeSeamError {
  readonly contacts: ContactEdge[];
  constructor(contacts: ContactEdge[]) {
    super();
    this.contacts=contacts;
  }
}

export class LatticeFragmentError extends Error {
  readonly contacts: ContactEdge[];
  constructor(contacts: ContactEdge[]) {
    super('The bottom disc did not connect every plank into one solid.');
    this.contacts=contacts;
  }
}

/** Recognize only tiny tetrahedral remnants sharing an exact vertex with the
 * main body's boundary. A detached piece across even a small gap is refused. */
function pointAttachedFragments(shells: Manifold[], bodies: Manifold[]): ContactEdge[] | undefined {
  if(bodies.length<2||bodies.length>9)return;
  const ordered=[...bodies].sort((a,b)=>b.volume()-a.volume()),fragments=ordered.slice(1);
  const candidates: {points:Map<string,Point3>;min:Point3;max:Point3}[]=[];
  for(const fragment of fragments) {
    if(fragment.volume()>1e-8)return;
    const mesh=fragment.getMesh();
    if(mesh.triVerts.length!==12)return;
    const min:Point3=[Infinity,Infinity,Infinity],max:Point3=[-Infinity,-Infinity,-Infinity],points=new Map<string,Point3>();
    for(let i=0;i<mesh.vertProperties.length;i+=3) {
      const point=Array.from(mesh.vertProperties.slice(i,i+3)) as Point3;
      points.set(point.join(','),point);
      for(let k=0;k<3;k++){min[k]=Math.min(min[k],point[k]);max[k]=Math.max(max[k],point[k]);}
    }
    if(Math.hypot(...max.map((n,k)=>n-min[k]))>.1)return;
    candidates.push({points,min,max});
  }
  const contacts=new Map<number,ContactEdge>();
  for(const shell of shells) {
    if(fragments.includes(shell))continue;
    const p=shell.getMesh().vertProperties;
    for(let c=0;c<candidates.length;c++) {
      if(contacts.has(c))continue;
      const {points,min,max}=candidates[c];
      for(let i=0;i<p.length;i+=3) {
        if(p[i]<min[0]||p[i]>max[0]||p[i+1]<min[1]||p[i+1]>max[1]||p[i+2]<min[2]||p[i+2]>max[2])continue;
        const point=points.get(`${p[i]},${p[i+1]},${p[i+2]}`);
        if(point){contacts.set(c,[point,point]);break;}
      }
    }
    if(contacts.size===candidates.length)return [...contacts.values()];
  }
}

/** Remove whole, proven microscopic tetrahedral remnants, never individual
 * faces. Preserve every cavity boundary and require a fresh full mesh audit. */
export function removeMicroscopicLatticeFragments(source: Manifold, wasm: ManifoldToplevel): Manifold {
  const shells=source.decompose();
  try {
    const bodies=shells.filter(s=>s.volume()>0).sort((a,b)=>b.volume()-a.volume());
    if(!pointAttachedFragments(shells,bodies))throw new Error('The bottom disc did not connect every plank into one solid.');
    const fragments=new Set(bodies.slice(1));
    // Preserve oriented cavity shells verbatim. compose() is a lazy union in
    // this kernel version and would fill negative-volume boundary shells.
    const meshes=shells.filter(shell=>!fragments.has(shell)).map(shell=>shell.getMesh());
    const positions=new Float32Array(meshes.reduce((n,m)=>n+m.vertProperties.length,0));
    const indices=new Uint32Array(meshes.reduce((n,m)=>n+m.triVerts.length,0));
    let vertexOffset=0,indexOffset=0;
    for(const mesh of meshes) {
      positions.set(mesh.vertProperties,vertexOffset*3);
      for(let i=0;i<mesh.triVerts.length;i++)indices[indexOffset+i]=mesh.triVerts[i]+vertexOffset;
      vertexOffset+=mesh.vertProperties.length/3;indexOffset+=mesh.triVerts.length;
    }
    return new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:positions,triVerts:indices}));
  } finally {for(const shell of shells)shell.delete();}
}

/** Close only microscopic four-face pinches, never holes or wrongly wound seams.
 * Pins have radius 0.001 mm and extend that far beyond each endpoint, so added
 * material stays within sqrt(2)*0.001 mm of the existing contact segments. */
export function resolveLatticeContacts(source: Manifold, contacts: ContactEdge[], wasm: ManifoldToplevel): Manifold {
  const mesh=source.getMesh();
  // Rebuild without stale simplification tolerance / face provenance.
  const parts: Manifold[]=[];
  try {
    parts.push(new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:mesh.vertProperties,triVerts:mesh.triVerts})));
    if(parts[0].status()!=='NoError')throw new Error('Contact reconstruction failed.');
    const radius=.001;
    for(const [a,b] of contacts) {
      const d=b.map((n,i)=>n-a[i]),length=Math.hypot(...d);
      let pin=wasm.Manifold.cylinder(length+2*radius,radius,radius,12);
      try {
        let next=pin.translate([0,0,-radius]);pin.delete();pin=next;
        next=pin.rotate([0,Math.acos(Math.max(-1,Math.min(1,d[2]/length)))*180/Math.PI,Math.atan2(d[1],d[0])*180/Math.PI]);pin.delete();pin=next;
        next=pin.translate(a);pin.delete();pin=next;
        parts.push(pin);
      } catch(error) {pin.delete();throw error;}
    }
    return wasm.Manifold.union(parts);
  } finally {for(const part of parts)part.delete();}
}

/** Weld a Float32-degenerate cluster or its microscopic short edge.
 * Every moved vertex stays within 0.1 micron of its original position.
 * Keep incident-face indices for kernel retriangulation and the full audit.
 * A long collinear face is repairable only when it has a microscopic edge. */
export function weldCollapsedLatticeSliver(positions: Float32Array, indices: Uint32Array): Float32Array | undefined {
  let repaired:Float32Array|undefined;
  for(let i=0;i<indices.length;i+=3) {
    const p=repaired??positions;
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2];
    const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)>=1e-12)continue;
    const reach=Math.max(Math.hypot(ux,uy,uz),Math.hypot(vx,vy,vz));
    if(reach===0)continue;
    if(reach<=0.0001) {
      // Bound total displacement even when neighbouring faces share vertices.
      if([b,c].some(v=>Math.hypot(positions[v]-p[a],positions[v+1]-p[a+1],positions[v+2]-p[a+2])>0.0001))continue;
      repaired??=positions.slice();
      for(const vertex of [b,c])for(let k=0;k<3;k++)repaired[vertex+k]=p[a+k];
      continue;
    }
    // Rounding may flatten a long cap triangle whose last two vertices are
    // only one Float32 ULP apart. Weld that short edge, never the long span.
    const pairs=[[a,b],[b,c],[c,a]].map(([from,to])=>({
      from,to,length:Math.hypot(p[from]-p[to],p[from+1]-p[to+1],p[from+2]-p[to+2])
    })).sort((x,y)=>x.length-y.length);
    for(const {from,to,length} of pairs) {
      if(length===0||length>0.0001)continue;
      if(Math.hypot(positions[to]-p[from],positions[to+1]-p[from+1],positions[to+2]-p[from+2])>0.0001)continue;
      repaired??=positions.slice();
      for(let k=0;k<3;k++)repaired[to+k]=p[from+k];
      break;
    }
  }
  return repaired;
}

/** Validate Float32 positions, including exact position welding as an STL reader does.
 * Handles are intentional in a lattice; unlike a tree, it need not have genus zero. */
export function inspectRectangleMesh(geometry: BufferGeometry,progress?:ProgressCallback) {
  const p = geometry.getAttribute('position'), index = geometry.getIndex();
  if (!index?.count) throw new Error('The lattice mesh is empty.');
  const vertices = new Map<string, number>();
  const representatives: number[]=[];
  const canonical = new Uint32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const xyz = [p.getX(i), p.getY(i), p.getZ(i)];
    if (!xyz.every(Number.isFinite)) throw new Error('Non-finite lattice vertex.');
    const key = xyz.join(',');
    if (!vertices.has(key)) {vertices.set(key, vertices.size);representatives.push(i);}
    canonical[i] = vertices.get(key)!;
  }
  const parents = Uint32Array.from({ length: vertices.size }, (_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  };
  const edges = new Map<number, { count: number; winding: number }>();
  let volume = 0;
  progress?.('Checking surface faces…',{phase:'checks',completed:0,total:index.count/3,unit:'faces'});
  for (let i = 0; i < index.count; i += 3) {
    if(i%24576===0)progress?.('Checking surface faces…',{phase:'checks',completed:i/3,total:index.count/3,unit:'faces'});
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const [a, b, c] = ids.map(id => [p.getX(id), p.getY(id), p.getZ(id)]);
    const u = b.map((v, k) => v - a[k]), v = c.map((n, k) => n - a[k]);
    const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    if (Math.hypot(...cross) < 1e-12) throw new Error('The lattice has a collapsed triangle after precision cleanup. Save this recipe so it can be checked.');
    volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    for (let j = 0; j < 3; j++) {
      const x = canonical[ids[j]], y = canonical[ids[(j + 1) % 3]];
      const key = Math.min(x, y) * vertices.size + Math.max(x, y);
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++; edge.winding += x < y ? 1 : -1; edges.set(key, edge);
      parents[root(x)] = root(y);
    }
  }
  progress?.('Checking seams and orientation…',{phase:'checks'});
  const bad: [number,{count:number;winding:number}][]=[];
  for(const entry of edges)if(entry[1].count!==2||entry[1].winding!==0)bad.push(entry);
  if(bad.length) {
    const contacts:ContactEdge[]=bad.map(([key])=>[Math.floor(key/vertices.size),key%vertices.size]
      .map(id=>{const i=representatives[id];return [p.getX(i),p.getY(i),p.getZ(i)] as Point3;}) as ContactEdge);
    if(bad.length<=64 && bad.every(([,e])=>e.count===4&&e.winding===0)
      && contacts.every(([a,b])=>{const length=Math.hypot(...a.map((n,i)=>n-b[i]));return length>0&&length<=.2;})) {
      throw new LatticeContactError(contacts);
    }
    throw new LatticeSeamError(bad.every(([,e])=>e.count===4&&e.winding===0)?contacts:undefined);
  }
  if (volume <= 0) throw new Error('The lattice has inverted orientation.');
  const components = new Set(Array.from(parents, (_, i) => root(i))).size;
  return { components, volume, triangles: index.count / 3, euler: vertices.size - edges.size + index.count / 3 };
}

/** Boolean-union the actual swept plank meshes, removing buried intersection faces. */
export async function unionRectangles(input: RectangleRecipe, runtime?: ManifoldToplevel, progress: ProgressCallback = () => {}, quality: RectangleQuality = 'export', previewRefinement = 0, previewStep?: number, deferTouchingSeams = false) {
  const recipe = validateRectangles(input);
  const wasm = runtime ?? await Module();
  if (!runtime) wasm.setup();
  let source:BufferGeometry|undefined;
  let sampleStep=recipe.layerHeight;
  const solids: Manifold[] = [];
  let joined: Manifold | undefined;
  try {
    const generated=generateRectangles(recipe,{quality,contours:false,previewRefinement,previewStep});
    source=generated.geometry;sampleStep=generated.sampleStep;
    const positions = source.getAttribute('position').array as Float32Array;
    const indices = source.getIndex()!.array;
    const verticesPerPlank = positions.length / 3 / recipe.count;
    const indicesPerPlank = indices.length / recipe.count;
    progress('Building individual strands…',{phase:'generate',completed:0,total:recipe.count,unit:'strands'});
    for (let i = 0; i < recipe.count; i++) {
      const mesh = new wasm.Mesh({ numProp: 3,
        vertProperties: positions.slice(i * verticesPerPlank * 3, (i + 1) * verticesPerPlank * 3),
        triVerts: Uint32Array.from(indices.slice(i * indicesPerPlank, (i + 1) * indicesPerPlank), n => n - i * verticesPerPlank),
      });
      const solid = new wasm.Manifold(mesh);
      solids.push(solid);
      if (solid.status() !== 'NoError') throw new Error(`Plank ${i + 1} could not form a solid: ${solid.status()}.`);
      if((i+1)%8===0||i+1===recipe.count)progress('Building individual strands…',{phase:'generate',completed:i+1,total:recipe.count,unit:'strands'});
    }
    if (recipe.bottomDisc) {
      progress('Adding the bottom disc and centre hole…');
      // Z=0..thickness overlaps the planks over the upper half of the disc.
      // 512 segments keep the radial chord error under 0.003 mm at the size limit.
      const outer = recipe.outline === 'circle'
        ? wasm.Manifold.cylinder(recipe.discThickness, recipe.diameter / 2, recipe.diameter / 2, 512)
        : wasm.Manifold.extrude([outlinePolygon(recipe)],recipe.discThickness);
      const center=centerAt(recipe,0);
      const shifted=(solid:Manifold)=>{if(center.x===0&&center.y===0)return solid;const moved=solid.translate([center.x,center.y,0]);solid.delete();return moved;};
      if(recipe.discHole===0)solids.push(shifted(outer));
      else {
        const bore = wasm.Manifold.cylinder(recipe.discThickness, recipe.discHole / 2, recipe.discHole / 2, 512);
        try { solids.push(shifted(outer.subtract(bore))); }
        finally { outer.delete(); bore.delete(); }
      }
    }
    progress(recipe.bottomDisc?'Fusing the bottom disc and planks…':'Joining plank crossings into a lattice…');
    joined = await nativeUnion(solids,wasm,recipe.bottomDisc,progress,quality,{consumeInputs:true});
    if (joined.status() !== 'NoError') throw new Error(`Lattice union failed: ${joined.status()}.`);
    // The native engine applies the same one-micron cleanup before Float32
    // transfer (setTolerance for a disc, simplify otherwise).
    // Re-import the exported Float32 mesh so the kernel resolves any vertices
    // that coincide only after rounding. It preserves manifold topology.
    // Each repair family has its own bounded budget. A collapsed sliver must
    // not consume the second contact repair needed after Float32 rounding.
    let contactRepairs=0,sliverRepairs=0,fragmentRepairs=0;
    for (;;) {
      const roundedMesh=joined.getMesh();
      joined.delete(); joined=undefined;
      joined=new wasm.Manifold(roundedMesh);
      if (joined.status() !== 'NoError') throw new Error(`Rounded lattice failed: ${joined.status()}.`);
      const mesh = joined.getMesh();
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(mesh.vertProperties.slice(), 3));
      geometry.setIndex(new BufferAttribute(mesh.triVerts.slice(), 1));
      try {
        progress('Checking the joined surface…');
        const audit = inspectRectangleMesh(geometry,(message,work)=>progress(message,{...work,phase:'fusion'}));
        if (recipe.bottomDisc && audit.components !== 1) assertConnectedRectangleSolid(joined,(message,work)=>progress(message,{...work,phase:'fusion'}));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        return { geometry, ...audit, sampleStep };
      } catch (error) {
        // A repair fill can remove exact-position contacts in an intermediate
        // solid. Only the export builder opts in, and it MUST run smoothCavity
        // (including its final STL-coordinate audit) before exposing a result.
        // Missing faces, winding errors and collapsed faces remain failures.
        if(deferTouchingSeams&&quality==='export'&&recipe.smoothCavity?.repairInset!==undefined
          &&error instanceof LatticeSeamError&&error.touchingContacts?.length) {
          progress('Checking touching seams after applying the smooth repair fill…');
          geometry.computeVertexNormals();geometry.computeBoundingBox();
          return {geometry,components:0,euler:Number.NaN,volume:joined.volume(),triangles:geometry.index!.count/3,sampleStep};
        }
        geometry.dispose();
        if(fragmentRepairs<3 && error instanceof LatticeFragmentError) {
          fragmentRepairs++;
          progress('Removing microscopic intersection remnants…');
          const healed=removeMicroscopicLatticeFragments(joined,wasm);
          joined.delete();joined=healed;
          if(joined.status()!=='NoError')throw new Error(`Intersection remnant cleanup failed: ${joined.status()}.`);
          continue;
        }
        if(contactRepairs<2 && error instanceof LatticeContactError) {
          contactRepairs++;
          progress('Resolving microscopic contact edges…');
          const healed=resolveLatticeContacts(joined,error.contacts,wasm);
          joined.delete();joined=healed;
          if(joined.status()!=='NoError')throw new Error(`Contact repair failed: ${joined.status()}.`);
          continue;
        }
        // A retriangulated cap can expose another collinear face only after
        // rounding. Re-import that exact Float32 mesh, then run every guard again.
        if (sliverRepairs >= 2 || !(error as Error).message.includes('collapsed triangle')) throw error;
        sliverRepairs++;
        const repaired = weldCollapsedLatticeSliver(mesh.vertProperties,mesh.triVerts);
        if(repaired) {
          progress(quality === 'export' ? 'Repairing microscopic export slivers…' : 'Repairing microscopic preview slivers…');
          const healed=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:repaired,triVerts:mesh.triVerts}));
          joined.delete();joined=healed;
          if(joined.status()!=='NoError')throw new Error(`Lattice precision repair failed: ${joined.status()}.`);
        } else {
          if(!recipe.bottomDisc)throw error;
          progress('Resolving rounded disc junctions…');
        }
      }
    }
  } finally {
    source?.dispose(); joined?.delete();
    for (const solid of solids) solid.delete();
  }
}
