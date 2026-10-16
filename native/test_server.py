"""Transport-limit tests; large payload uses a stub, not expensive geometry."""
import http.client, json, struct, threading, unittest
from types import SimpleNamespace
from unittest.mock import patch
from server import Handler, ThreadingHTTPServer, gate

class UploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
    def assert_gate_released(self):
        # A response can arrive just before the request's finally block runs.
        self.assertTrue(gate.acquire(timeout=2))
        gate.release()
    def connection(self):
        return http.client.HTTPConnection("127.0.0.1",self.server.server_port,timeout=10)
    def test_reduced_stl_route_and_gate(self):
        import tempfile
        import manifold3d as m
        from reduce_export import write_stl
        with tempfile.TemporaryDirectory() as directory:
            from pathlib import Path
            path=Path(directory)/'input.stl'
            mesh=m.Manifold.sphere(20,40).to_mesh()
            write_stl(path,mesh.vert_properties,mesh.tri_verts)
            payload=path.read_bytes()
        conn=self.connection(); conn.request('POST','/simplify',body=payload)
        response=conn.getresponse(); data=response.read(); conn.close()
        self.assertEqual(response.status,200,data[:400])
        length=struct.unpack_from('<I',data)[0]
        metadata=json.loads(data[4:4+length])
        self.assertTrue(metadata['passedExportChecks'])
        self.assertFalse(metadata['selfIntersectionsChecked'])
        self.assertLess(metadata['triangles'],metadata['originalTriangles'])
        self.assertEqual(len(data)-4-length,84+50*metadata['triangles'])
        self.assertTrue(gate.acquire(timeout=2))
        try:
            conn=self.connection(); conn.request('POST','/simplify',headers={'Content-Length':'1000'})
            response=conn.getresponse(); self.assertEqual(response.status,503)
            response.read(); conn.close()
        finally: gate.release()
        conn=self.connection(); conn.request('POST','/simplify',body=b'x'*284)
        response=conn.getresponse(); self.assertEqual(response.status,422)
        response.read(); conn.close(); self.assert_gate_released()

    def test_large_upload_and_gate_release(self):
        header=json.dumps({"version":1,"quality":"export"}).encode()
        blob=bytearray(129*1024*1024)
        struct.pack_into("<I",blob,0,len(header)); blob[4:4+len(header)]=header
        output_header=b'{"metrics":{"totalMs":1}}'
        output=struct.pack("<I",len(output_header))+output_header
        def compute(*args,**kwargs):
            self.assertEqual(len(kwargs["input"]),len(blob))
            self.assertEqual(kwargs["timeout"],600)
            return SimpleNamespace(returncode=0,stdout=output)
        with patch("server.subprocess.run",side_effect=compute):
            conn=self.connection(); conn.request("POST","/union",body=blob)
            response=conn.getresponse(); self.assertEqual(response.status,200)
            self.assertEqual(response.read(),output); conn.close()
        self.assert_gate_released()
    def test_oversize_rejected_before_body(self):
        conn=self.connection()
        conn.request("POST","/union",headers={"Content-Length":str(513*1024*1024)})
        response=conn.getresponse(); self.assertEqual(response.status,413)
        self.assertIn(b"512 MB",response.read()); conn.close()
    def test_busy_rejected_before_body(self):
        gate.acquire()
        try:
            conn=self.connection()
            conn.request("POST","/union",headers={"Content-Length":str(129*1024*1024)})
            response=conn.getresponse(); self.assertEqual(response.status,503)
            response.read(); conn.close()
        finally: gate.release()
    def test_killed_process_reports_only_confirmed_oom(self):
        header=b'{"quality":"export"}'
        blob=struct.pack("<I",len(header))+header
        for counts,confirmed in [([0,1],True),([1,1],False),([None,None],False)]:
            with self.subTest(counts=counts), patch("server.oom_kills",side_effect=counts), patch("server.memory_limit_label",return_value="10 GB"), patch("server.subprocess.run",return_value=SimpleNamespace(returncode=-9,stderr=b"")):
                conn=self.connection(); conn.request("POST","/union",body=blob)
                response=conn.getresponse(); self.assertEqual(response.status,422)
                detail=json.loads(response.read())["error"]; conn.close()
                if confirmed:
                    self.assertIn("ran out of memory",detail)
                    self.assertIn("10 GB",detail)
                    self.assertIn("Increase the STL step",detail)
                else: self.assertIn("could not be confirmed",detail)

    def test_invalid_header_releases_gate(self):
        conn=self.connection(); conn.request("POST","/union",body=b"bad!")
        response=conn.getresponse(); self.assertEqual(response.status,422)
        response.read(); conn.close(); self.assert_gate_released()

if __name__=="__main__": unittest.main()
