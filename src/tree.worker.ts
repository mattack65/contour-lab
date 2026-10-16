import { growTree, meshTree, meshTreeForExport, sliceMesh, inspectOverhangs } from './tree.ts';
self.onmessage = (event) => {
  try {
    const { recipe, quality } = event.data;
    const growth = growTree(recipe);
    const result = quality === 'export' || recipe.growthStyle===3
      ? meshTreeForExport(growth, recipe, progress => self.postMessage({ progress }))
      : meshTree(growth, recipe, quality);
    const contourPoints:number[]=[];
    if(quality==='preview') {
      for(let z=0.5;z<result.geometry.boundingBox!.max.z;z+=Math.max(1.5,recipe.layerHeight*5,result.geometry.boundingBox!.max.z/80)) {
        for(const n of sliceMesh(result.geometry,z))contourPoints.push(n);
      }
    }
    const lines=new Float32Array(contourPoints);
    const positions = result.geometry.getAttribute('position').array;
    const indices = result.geometry.getIndex()!.array;
    const normals = result.geometry.getAttribute('normal').array;
    self.postMessage({ positions, indices, normals, lines, spacing: result.spacing, triangles: result.triangles,
      summary: { forks:growth.forks, avoided:growth.avoided, limited:growth.limited, branches:growth.branches.length, bounds:growth.bounds, overhang:recipe.growthStyle===3?inspectOverhangs(result.geometry).maximum:undefined } }, { transfer: [positions.buffer,indices.buffer,normals.buffer,lines.buffer] });
  } catch(error) { self.postMessage({ error: (error as Error).message }); }
};
