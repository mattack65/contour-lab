"""Check the interface and the geometry service through the unchanged Vite proxy."""
import json
from urllib.request import urlopen

with urlopen("http://127.0.0.1:5173/", timeout=2) as response:
    if response.status != 200:
        raise SystemExit(1)
with urlopen("http://127.0.0.1:5173/api/native/health", timeout=2) as response:
    if response.status != 200 or json.load(response).get("engine") != "native Manifold":
        raise SystemExit(1)
