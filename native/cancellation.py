"""Per-request cancellation; never stop another tab's geometry job."""
import os, re, signal, subprocess, threading, time

class Cancelled(Exception):
    pass

class Job:
    def __init__(self):
        self.cancelled = threading.Event()
        self.done = threading.Event()

class Jobs:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = {}
        self.pending = {}

    @staticmethod
    def valid(token):
        return bool(re.fullmatch(r"[0-9a-fA-F-]{36}", token or ""))

    def prune(self):
        now = time.monotonic()
        self.pending = {k:v for k,v in self.pending.items() if v > now}

    def start(self, token):
        with self.lock:
            self.prune()
            if token in self.pending:
                raise Cancelled()
            if token in self.active:
                raise ValueError("Geometry job is already running")
            job = Job()
            self.active[token] = job
            return job

    def finish(self, token, job):
        with self.lock:
            self.active.pop(token, None)
            if job.cancelled.is_set():
                self.pending[token] = time.monotonic()+60
            job.done.set()

    def cancel(self, token):
        with self.lock:
            self.prune()
            job = self.active.get(token)
            if job:
                job.cancelled.set()
            else:
                # Cover Cancel arriving before the worker's upload. Bound memory.
                if len(self.pending) >= 256:
                    self.pending.pop(next(iter(self.pending)))
                self.pending[token] = time.monotonic()+60
            return job

jobs = Jobs()

def run_cancellable(args, *, input, timeout, job):
    if job.cancelled.is_set():
        raise Cancelled()
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    # communicate must run once: retrying after short timeouts can leave a large
    # stdin upload unfinished. Drain all pipes concurrently while monitoring it.
    finished = threading.Event()
    output = []
    errors = []
    def communicate():
        try:
            output.append(process.communicate(input=input))
        except BaseException as error:
            errors.append(error)
        finally:
            finished.set()
    io_thread = threading.Thread(target=communicate)
    io_thread.start()
    deadline = time.monotonic()+timeout
    try:
        while True:
            if job.cancelled.is_set():
                raise Cancelled()
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(args, timeout)
            if finished.wait(min(.1, remaining)):
                if job.cancelled.is_set():
                    raise Cancelled()
                if errors:
                    raise errors[0]
                stdout, stderr = output[0]
                return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        io_thread.join()
