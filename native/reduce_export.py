"""Reduced STL adapter; ordinary mesh checks, no self-intersection guarantee."""
import json, os, struct, subprocess, sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
RECORD=np.dtype([('normal','<f4',(3,)),('vertices','<f4',(3,3)),('attribute','<u2')])

def read_stl(path):
    with open(path, 'rb') as stream:
        prefix = stream.read(84)
    if len(prefix) != 84:
        raise ValueError('Incomplete binary STL')
    count = struct.unpack_from('<I', prefix, 80)[0]
    if count < 4 or Path(path).stat().st_size != 84 + count * 50:
        raise ValueError('Invalid binary STL size')
    rows = np.memmap(path, dtype=RECORD, offset=84, shape=(count,), mode='r')
    positions = rows['vertices'].reshape(-1, 3).copy()
    if not np.isfinite(positions).all():
        raise ValueError('STL contains non-finite coordinates')
    vertices, inverse = np.unique(positions, axis=0, return_inverse=True)
    return vertices.astype(np.float64), inverse.reshape(-1, 3).astype(np.int32)

def write_stl(path, vertices, faces):
    vertices = np.asarray(vertices, dtype='<f4')
    faces = np.asarray(faces)
    if (vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all()
            or faces.ndim != 2 or faces.shape[1] != 3 or len(faces) < 4
            or faces.min() < 0 or faces.max() >= len(vertices)):
        raise ValueError('Simplifier returned invalid coordinates or indices')
    with open(path, 'xb') as stream:
        stream.write(b'Contour Lab - QEM reduced STL'.ljust(80, b'\0'))
        stream.write(struct.pack('<I', len(faces)))
        for first in range(0, len(faces), 65536):
            tri = vertices[faces[first:first+65536]]
            rows = np.zeros(len(tri), dtype=RECORD)
            rows['vertices'] = tri
            cross = np.cross(tri[:, 1].astype(float)-tri[:, 0], tri[:, 2].astype(float)-tri[:, 0])
            lengths = np.linalg.norm(cross, axis=1)
            if np.any(lengths == 0):
                raise ValueError('STL rounding collapsed a triangle')
            rows['normal'] = cross / lengths[:, None]
            stream.write(rows.tobytes())

def reduce_export(source,destination):
    result=subprocess.run([str(HERE/'reduce_mesh'),str(source),str(destination),'0.3333333333333333'],capture_output=True,text=True,timeout=600)
    if result.returncode:
        raise ValueError(result.stderr.strip().splitlines()[-1])
    return json.loads(result.stdout)

if __name__=='__main__':
    if len(sys.argv)!=3: sys.exit('Expected source and destination')
    # Replace this process so server timeout/OOM handling owns the actual job.
    os.execv(str(HERE/'reduce_mesh'),[str(HERE/'reduce_mesh'),sys.argv[1],sys.argv[2],'0.3333333333333333'])
