import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import manifold3d as m
from reduce_export import read_stl, write_stl, reduce_export
from stl_mesh import audit

class ReductionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source=Path(self.temp.name)/'source.stl'
        self.output=Path(self.temp.name)/'reduced.stl'

    def save(self, solid):
        mesh=solid.to_mesh()
        write_stl(self.source,mesh.vert_properties,mesh.tri_verts)

    def verify_reduced(self):
        original=self.source.read_bytes()
        result=reduce_export(self.source,self.output)
        points,faces=read_stl(self.output)
        self.assertTrue(audit(points,faces)['closed'])
        self.assertTrue(result['passedExportChecks'])
        self.assertFalse(result['selfIntersectionsChecked'])
        self.assertLess(result['actualFraction'],1)
        self.assertEqual(self.source.read_bytes(),original)
        self.assertEqual(len(faces),result['triangles'])
        return points,faces

    def test_sphere(self):
        self.save(m.Manifold.sphere(30,100))
        points,faces=self.verify_reduced()
        self.assertEqual(audit(points,faces)['euler'],2)

    def test_open_vase_preserves_floor_and_cavity(self):
        outside=m.Manifold.cylinder(50,30,35,128)
        inside=m.Manifold.cylinder(50,27,32,128).translate((0,0,2))
        self.save((outside-inside).refine(4))
        points,faces=self.verify_reduced()
        solid=m.Manifold(m.Mesh(points.astype(np.float32),faces.astype(np.uint32)))
        self.assertEqual(solid.status(),m.Error.NoError)
        # Mid-height slice retains both contours, not a filled cylinder.
        self.assertEqual(len(solid.slice(25).to_polygons()),2)
        self.assertEqual(len(solid.slice(1).to_polygons()),1)

    def test_multiple_bodies_not_dropped(self):
        self.save(m.Manifold.sphere(10,64)+m.Manifold.sphere(7,64).translate((30,0,0)))
        p,f=self.verify_reduced()
        solid=m.Manifold(m.Mesh(p.astype(np.float32),f.astype(np.uint32)))
        self.assertEqual(len(solid.decompose()),2)

    def test_open_and_reversed_mesh_rejected_without_output(self):
        mesh=m.Manifold.sphere(10,24).to_mesh()
        for faces in (mesh.tri_verts[:-1],mesh.tri_verts[:,::-1]):
            self.source.unlink(missing_ok=True)
            write_stl(self.source,mesh.vert_properties,faces)
            with self.assertRaises(ValueError): reduce_export(self.source,self.output)
            self.assertFalse(self.output.exists())

    def test_existing_file_preserved(self):
        self.output.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError,'Output exists'): reduce_export(self.source,self.output)
        self.assertEqual(self.output.read_bytes(),b'keep')

    def test_truncated_stl(self):
        self.source.write_bytes(b'bad')
        with self.assertRaises(ValueError): read_stl(self.source)

if __name__=='__main__': unittest.main()


