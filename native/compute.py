"""Native C++ Manifold via its official Python binding. Binary mesh input/output."""
import json, os, struct, sys, time, resource
from pathlib import Path
threads=max(1,min(8,int(os.environ.get("NATIVE_THREADS","4"))))
cpus=[]
if hasattr(os,"sched_getaffinity"):
    allowed=sorted(os.sched_getaffinity(0))
    # Prefer one hardware thread per physical core before using SMT siblings.
    seen=set()
    for cpu in allowed:
        topology=Path(f"/sys/devices/system/cpu/cpu{cpu}/topology")
        try: key=((topology/"physical_package_id").read_text().strip(),(topology/"core_id").read_text().strip())
        except OSError: key=("unknown",str(cpu))
        if key not in seen: seen.add(key);cpus.append(cpu)
    cpus=(cpus+[c for c in allowed if c not in cpus])[:threads]
    os.sched_setaffinity(0,cpus)
import numpy as np
import manifold3d as m

def decode(blob):
    if len(blob)<4: raise ValueError("Missing mesh header")
    size=struct.unpack_from("<I",blob)[0]
    if size>2*1024*1024 or size+4>len(blob): raise ValueError("Invalid mesh header")
    meta=json.loads(blob[4:4+size])
    if not isinstance(meta,dict) or meta.get("version")!=1: raise ValueError("Unsupported mesh protocol")
    parts=meta.get("parts",[])
    if not 1<=len(parts)<=32769: raise ValueError("Invalid solid count")
    offset=(4+size+3)&~3
    meshes=[]
    for part in parts:
        nv,ni=part["vertices"],part["indices"]
        if not isinstance(nv,int) or not isinstance(ni,int) or nv<4 or ni<12 or ni%3: raise ValueError("Invalid mesh dimensions")
        end=offset+nv*12+ni*4
        if end>len(blob): raise ValueError("Truncated mesh")
        p=np.frombuffer(blob,dtype="<f4",count=nv*3,offset=offset).reshape((-1,3)).copy()
        idx=np.frombuffer(blob,dtype="<u4",count=ni,offset=offset+nv*12).reshape((-1,3)).copy()
        if not np.isfinite(p).all() or idx.max()>=nv: raise ValueError("Invalid mesh data")
        meshes.append(m.Mesh(p,idx))
        offset=end
    if offset!=len(blob): raise ValueError("Unexpected trailing mesh data")
    return meta,meshes

def encode(mesh,metrics):
    p=np.asarray(mesh.vert_properties,dtype="<f4")
    idx=np.asarray(mesh.tri_verts,dtype="<u4")
    # No vertex properties beyond XYZ are used in this pipeline.
    if p.shape[1]!=3: raise ValueError("Unexpected vertex properties")
    meta={"version":1,"parts":[{"vertices":len(p),"indices":idx.size}],"metrics":metrics}
    header=json.dumps(meta,separators=(",",":")).encode()
    prefix=struct.pack("<I",len(header))+header
    return prefix+b"\0"*((-len(prefix))%4)+p.tobytes()+idx.tobytes()

def compute(blob):
    total=time.perf_counter()
    cpu_start=time.process_time()
    meta,meshes=decode(blob)
    solids=[m.Manifold(mesh) for mesh in meshes]
    if any(s.status()!=m.Error.NoError for s in solids): raise ValueError("Native input did not form closed solids")
    imported=time.perf_counter()
    joined=m.Manifold.batch_boolean(solids,m.OpType.Add)
    if joined.status()!=m.Error.NoError: raise ValueError("Native lattice union failed: "+str(joined.status()))
    fused=time.perf_counter()
    joined=joined.set_tolerance(.001) if meta.get("bottomDisc") else joined.simplify(.001)
    if joined.status()!=m.Error.NoError: raise ValueError("Native lattice cleanup failed: "+str(joined.status()))
    mesh=joined.to_mesh()
    done=time.perf_counter()
    return encode(mesh,{"importMs":(imported-total)*1000,"unionMs":(fused-imported)*1000,"cleanupMs":(done-fused)*1000,"totalMs":(done-total)*1000,"threads":threads,"cpus":cpus,"cpuSeconds":time.process_time()-cpu_start,"peakRSSMiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024})
if __name__=="__main__":
    try: sys.stdout.buffer.write(compute(sys.stdin.buffer.read()))
    except Exception as e:
        print(str(e),file=sys.stderr);sys.exit(1)
