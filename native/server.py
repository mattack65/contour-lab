from cancellation import jobs, run_cancellable, Cancelled
import json, os, subprocess, threading, struct, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path
MAX_INPUT_BYTES=512*1024*1024
gate=threading.Lock()
def oom_kills():
    try:
        events=dict(line.split() for line in Path("/sys/fs/cgroup/memory.events").read_text().splitlines())
        return int(events["oom_kill"])
    except (OSError,KeyError,ValueError): return None

def memory_limit_label():
    try: return f"{int(Path('/sys/fs/cgroup/memory.max').read_text())/1024**3:g} GB"
    except (OSError,ValueError): return "configured"

class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def reply(self,status,body,content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError): pass
    def do_GET(self):
        if self.path!="/health": return self.reply(404,b'{"error":"Not found"}')
        self.reply(200,json.dumps({"engine":"native Manifold","version":version("manifold3d"),"threads":int(os.environ.get("NATIVE_THREADS","4"))}).encode())
    def simplify(self):
        try: size=int(self.headers.get("Content-Length","0"))
        except ValueError: size=0
        if size<284 or size>MAX_INPUT_BYTES:
            self.close_connection=True
            return self.reply(413,b'{"error":"STL must be a complete binary file under 512 MB."}')
        if not gate.acquire(blocking=False):
            self.close_connection=True
            return self.reply(503,b'{"error":"Geometry processing is busy. Please retry shortly."}')
        try:
            with tempfile.TemporaryDirectory(prefix="reduced-stl-") as directory:
                source=Path(directory)/"source.stl"; output=Path(directory)/"reduced.stl"
                # Stream input to disk so large STL uploads don't duplicate the
                # decimator's memory. The request-level gate is shared with union.
                remaining=size
                with source.open('wb') as stream:
                    while remaining:
                        chunk=self.rfile.read(min(1024*1024,remaining))
                        if not chunk:
                            self.close_connection=True
                            return self.reply(400,b'{"error":"Incomplete STL upload."}')
                        stream.write(chunk); remaining-=len(chunk)
                with source.open('rb') as stream: prefix=stream.read(84)
                if 84+50*struct.unpack_from('<I',prefix,80)[0]!=size:
                    return self.reply(422,b'{"error":"Invalid binary STL length."}')
                oom_before=oom_kills()
                result=subprocess.run(["python","reduce_export.py",str(source),str(output)],capture_output=True,timeout=600)
                if result.returncode:
                    oom_after=oom_kills()
                    if result.returncode==-9 and oom_before is not None and oom_after is not None and oom_after>oom_before:
                        detail=f"STL reduction ran out of memory ({memory_limit_label()} service limit). Full-detail export is still available."
                    else: detail=result.stderr.decode(errors="replace")[-2000:] or "STL reduction stopped before completion."
                    return self.reply(422,json.dumps({"error":detail}).encode())
                metrics=json.loads(result.stdout)
                if metrics.get('passedExportChecks') is not True or not output.is_file():
                    raise ValueError('STL reduction did not pass export checks')
                header=json.dumps(metrics).encode()
                self.reply(200,struct.pack('<I',len(header))+header+output.read_bytes(),"application/octet-stream")
                print(json.dumps({"operation":"simplify","metrics":metrics}),flush=True)
        except subprocess.TimeoutExpired:
            self.reply(504,b'{"error":"STL reduction exceeded 10 minutes. No file was downloaded; try full-detail export."}')
        except (OSError,ValueError,struct.error) as error:
            self.reply(422,json.dumps({"error":str(error)}).encode())
        finally: gate.release()

    def do_POST(self):
        if self.path=="/cancel":
            self.close_connection=True
            token=self.headers.get("X-Contour-Job-ID", "")
            if not jobs.valid(token): return self.reply(400,b'{"error":"Invalid job ID"}')
            job=jobs.cancel(token)
            finished=job is None or job.done.wait(2)
            return self.reply(200,json.dumps({"cancelled":True,"finished":finished}).encode())
        if self.path=="/simplify": return self.simplify()
        if self.path!="/union": return self.reply(404,b'{"error":"Not found"}')
        try: size=int(self.headers.get("Content-Length","0"))
        except ValueError: size=0
        if size<4 or size>MAX_INPUT_BYTES:
            self.close_connection=True
            return self.reply(413,json.dumps({"error":f"Mesh request exceeds the {MAX_INPUT_BYTES//1024//1024} MB limit or is incomplete"}).encode())
        # Admit only one upload before reading its body: queued large payloads
        # must not consume the memory reserved for the active fusion process.
        if not gate.acquire(blocking=False):
            self.close_connection=True
            return self.reply(503,b'{"error":"Native fusion is still processing the previous build. Please retry shortly."}')
        token=self.headers.get("X-Contour-Job-ID", "")
        job=None
        try:
            if token:
                if not jobs.valid(token):
                    self.close_connection=True
                    return self.reply(400,b'{"error":"Invalid job ID"}')
                try: job=jobs.start(token)
                except ValueError:
                    self.close_connection=True
                    return self.reply(409,b'{"error":"Duplicate job ID"}')
            blob=self.rfile.read(size)
            if len(blob)!=size:
                self.close_connection=True
                return self.reply(400,b'{"error":"Incomplete request"}')
            try:
                length=struct.unpack_from("<I",blob)[0]
                if length>65536 or length+4>len(blob): raise ValueError("Invalid mesh header")
                header=json.loads(blob[4:4+length])
                if not isinstance(header,dict): raise ValueError("Invalid mesh header")
                if header.get("quality","preview") not in ("preview","export"): raise ValueError("Invalid mesh quality")
            except (ValueError,TypeError,struct.error):
                return self.reply(422,b'{"error":"Invalid mesh header"}')
            timeout=600 if header.get("quality")=="export" else 180
            oom_before=oom_kills()
            result=run_cancellable(["python","compute.py"],input=blob,timeout=timeout,job=job) if job else subprocess.run(["python","compute.py"],input=blob,capture_output=True,timeout=timeout)
            if result.returncode:
                oom_after=oom_kills()
                if result.returncode==-9 and oom_before is not None and oom_after is not None and oom_after>oom_before:
                    detail=f"Geometry fusion ran out of memory and was stopped (service memory limit: {memory_limit_label()}). Increase the STL step or reduce round sides or strand count, then retry. The previous preview is unchanged."
                else:
                    detail=result.stderr.decode(errors="replace")[-2000:] or ("Native process ended with code "+str(result.returncode)+". "+("The process was killed; out-of-memory could not be confirmed." if result.returncode==-9 else "Geometry processing failed."))
                return self.reply(422,json.dumps({"error":detail}).encode())
            length=struct.unpack_from("<I",result.stdout)[0]
            metrics=json.loads(result.stdout[4:4+length])["metrics"]
            print(json.dumps({"quality":header.get("quality","preview"),"metrics":metrics}),flush=True)
            self.reply(200,result.stdout,"application/octet-stream")
        except Cancelled:
            self.close_connection=True
            self.reply(409,b'{"error":"Build cancelled"}')
        except subprocess.TimeoutExpired:
            self.reply(504,json.dumps({"error":f"Native fusion exceeded the {timeout} second limit"}).encode())
        finally:
            gate.release()
            if job: jobs.finish(token,job)
if __name__=="__main__":
    ThreadingHTTPServer(("0.0.0.0",8000),Handler).serve_forever()
