# Same Vite/Node and native geometry runtimes, packaged together.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS studio-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund

FROM python:3.12-slim-bookworm AS reducer-build
RUN apt-get update && apt-get install -y --no-install-recommends g++ libcgal-dev libeigen3-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY native/reduce_mesh.cpp .
RUN g++ -std=c++17 -O2 -DNDEBUG -frounding-math -fno-fast-math -I/usr/include/eigen3 reduce_mesh.cpp -o reduce_mesh -lgmp -lmpfr -pthread

FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir manifold3d==3.5.3 numpy==2.3.3
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgmp10 libmpfr6 && rm -rf /var/lib/apt/lists/*
COPY --from=studio-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=studio-deps /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
WORKDIR /app
RUN chown node:node /app
COPY --chown=node:node . .
COPY --from=studio-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=reducer-build /build/reduce_mesh /app/native/reduce_mesh
ENV NATIVE_THREADS=4 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER node
EXPOSE 5173
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["python", "container/healthcheck.py"]
CMD ["python", "container/run.py"]
