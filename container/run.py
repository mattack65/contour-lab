"""Run the existing services together; fail together and terminate their child jobs."""
import os
from pathlib import Path
import signal
import subprocess
import threading
import time


def main():
    root = Path(__file__).resolve().parent.parent
    stopping = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopping.set())
    children = []
    result = 0
    try:
        for name, cwd, command in (
            ("geometry", root / "native", ["python", "server.py"]),
            ("studio", root, ["npm", "run", "dev"]),
        ):
            if stopping.is_set():
                break
            child = subprocess.Popen(command, cwd=cwd, start_new_session=True)
            children.append((name, child))
            print(f"[launcher] Started {name} (PID {child.pid})", flush=True)
        while not stopping.wait(.2):
            for name, child in children:
                if child.poll() is not None:
                    print(f"[launcher] {name} exited ({child.returncode}); stopping both services", flush=True)
                    result = 1
                    stopping.set()
                    break
    except Exception as error:
        print(f"[launcher] Startup failed: {error}", flush=True)
        result = 1
    finally:
        # Each process group includes npm/Vite or native calculation subprocesses.
        # Signal groups even when the parent has exited, to catch orphaned jobs.
        for _, child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 8
        for _, child in children:
            try:
                child.wait(timeout=max(.01, deadline-time.monotonic()))
            except subprocess.TimeoutExpired:
                pass
        for _, child in children:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        print("[launcher] Services stopped", flush=True)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
