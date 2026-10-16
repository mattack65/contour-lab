"""Same coordinate/edge/winding/area/volume checks as inspectRectangleMesh.
No self-intersection guarantee.
"""
import json
import numpy as np

class AuditFailure(ValueError):
    def __init__(self,message,positions):
        super().__init__(message)
        self.positions=np.asarray(positions,dtype=np.float32).reshape(-1,3)

def audit(p,idx):
    if not np.isfinite(p).all() or idx.max()>=len(p): raise ValueError("Invalid coordinates or indices")
    verts,canonical=np.unique(p,axis=0,return_inverse=True)
    t=canonical[idx];n=len(verts)
    edges=np.concatenate((t[:,[0,1]],t[:,[1,2]],t[:,[2,0]]))
    signs=np.where(edges[:,0]<edges[:,1],1,-1).astype(np.int8)
    keys=edges.min(axis=1).astype(np.uint64)*n+edges.max(axis=1)
    order=np.argsort(keys);keys=keys[order];signs=signs[order]
    unique,start,counts=np.unique(keys,return_index=True,return_counts=True)
    winding=np.add.reduceat(signs,start)
    bad=(counts!=2)|(winding!=0)
    if np.any(bad):
        bad_keys=unique[bad]
        a=verts[(bad_keys//n).astype(int)];b=verts[(bad_keys%n).astype(int)]
        detail={"badEdges":int(bad.sum()),"incidentFaces":np.unique(counts[bad]).tolist(),"winding":np.unique(winding[bad]).tolist(),"lengthsMm":np.linalg.norm(a-b,axis=1)[:20].tolist(),"firstEdges":[[x.tolist(),y.tolist()] for x,y in zip(a[:4],b[:4])]}
        raise AuditFailure("Reduced mesh has open or multiply shared edges",np.concatenate((a,b)))
    volume=0.;minimum=float('inf');collapsed=[]
    for begin in range(0,len(idx),100000):
        xyz=p[idx[begin:begin+100000]].astype(np.float64)
        cross=np.cross(xyz[:,1]-xyz[:,0],xyz[:,2]-xyz[:,0])
        area=np.linalg.norm(cross,axis=1)
        minimum=min(minimum,float(area.min()))
        if np.any(area<1e-12): collapsed.append(xyz[area<1e-12].reshape(-1,3))
        volume+=float(np.einsum('ij,ij->i',xyz[:,0],np.cross(xyz[:,1],xyz[:,2])).sum()/6)
    if collapsed: raise AuditFailure("Reduced mesh has collapsed triangles",np.concatenate(collapsed))
    if volume<=0: raise ValueError("Inverted mesh orientation")
    return {"closed":True,"consistentWinding":True,"collapsedTriangles":0,"euler":n-len(unique)+len(idx),"volumeMm3":volume,"minimumDoubleAreaMm2":minimum}
