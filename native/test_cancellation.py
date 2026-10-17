"""Exercise actual child cancellation and the HTTP cancel/build race."""
import http.client, json, os, struct, subprocess, sys, tempfile, threading, time, unittest, uuid
from pathlib import Path
from unittest.mock import patch
from cancellation import Cancelled, Job, Jobs, run_cancellable
from server import Handler, ThreadingHTTPServer, gate

class CancellationTests(unittest.TestCase):
    def test_completed_process_preserves_input_and_output(self):
        payload = b'x' * 1000000
        result = run_cancellable([sys.executable, '-c', 'import sys,time;time.sleep(.25);sys.stdout.buffer.write(sys.stdin.buffer.read())'], input=payload, timeout=3, job=Job())
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, payload)

    def test_cancellation_reaps_real_process(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory)/'pid'
            job = Job(); errors = []
            def work():
                try:
                    run_cancellable([sys.executable, '-c', 'import os,time,pathlib,sys;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(60)', str(marker)], input=b'', timeout=90, job=job)
                except Exception as error: errors.append(error)
            thread = threading.Thread(target=work); thread.start()
            deadline = time.monotonic()+3
            while not marker.exists() and time.monotonic()<deadline: time.sleep(.01)
            self.assertTrue(marker.exists())
            pid = int(marker.read_text()); start = time.monotonic()
            job.cancelled.set(); thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertIsInstance(errors[0], Cancelled)
            self.assertLess(time.monotonic()-start, 2)
            with self.assertRaises(ProcessLookupError): os.kill(pid, 0)

    def test_timeout_and_job_isolation(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            run_cancellable([sys.executable, '-c', 'import time;time.sleep(60)'], input=b'', timeout=.2, job=Job())
        registry = Jobs(); a, b = str(uuid.uuid4()), str(uuid.uuid4())
        first = registry.start(a); second = registry.start(b)
        registry.cancel(a)
        self.assertTrue(first.cancelled.is_set()); self.assertFalse(second.cancelled.is_set())
        registry.finish(a, first)
        with self.assertRaises(Cancelled): registry.start(a)
        late = str(uuid.uuid4()); registry.cancel(late)
        with self.assertRaises(Cancelled): registry.start(late)

    def test_http_cancel_releases_gate_and_allows_next_build(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        serving = threading.Thread(target=server.serve_forever, daemon=True); serving.start()
        header = b'{"quality":"preview"}'
        payload = struct.pack('<I',len(header))+header
        output_header = b'{"metrics":{"totalMs":1}}'
        output = struct.pack('<I',len(output_header))+output_header
        def request(path, token, body=b''):
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            conn.request('POST', path, body=body, headers={'X-Contour-Job-ID': token})
            response=conn.getresponse(); result=(response.status,response.read()); conn.close(); return result
        entered=threading.Event(); results=[]
        def compute(args, *, input, timeout, job):
            entered.set()
            return run_cancellable([sys.executable,'-c','import time;time.sleep(60)'], input=input,timeout=timeout,job=job)
        try:
            token=str(uuid.uuid4())
            with patch('server.run_cancellable',side_effect=compute):
                build=threading.Thread(target=lambda: results.append(request('/union',token,payload)))
                build.start(); self.assertTrue(entered.wait(3))
                code, body=request('/cancel',token)
                self.assertEqual(code,200); self.assertTrue(json.loads(body)['finished'])
                build.join(3); self.assertFalse(build.is_alive()); self.assertEqual(results[0][0],409)
            self.assertTrue(gate.acquire(timeout=1)); gate.release()
            late=str(uuid.uuid4()); self.assertEqual(request('/cancel',late)[0],200)
            self.assertEqual(request('/union',late,payload)[0],409)
            with patch('server.run_cancellable',return_value=subprocess.CompletedProcess([],0,output,b'')):
                self.assertEqual(request('/union',str(uuid.uuid4()),payload),(200,output))
        finally:
            server.shutdown(); server.server_close(); serving.join()

if __name__=='__main__': unittest.main()
