# Third-party components

Dependencies are downloaded during the Docker build; their original licence files remain in the installed packages. This repository does not vendor those libraries.

- [Manifold](https://github.com/elalish/manifold): Apache-2.0 (JavaScript/WASM and Python bindings).
- [Three.js](https://github.com/mrdoob/three.js), [Tweakpane](https://github.com/cocopon/tweakpane), [Vite](https://github.com/vitejs/vite): MIT.
- [TypeScript](https://github.com/microsoft/TypeScript): Apache-2.0.
- [NumPy](https://github.com/numpy/numpy): BSD-3-Clause, with additional bundled-library notices.
- [CGAL](https://www.cgal.org/license.html): GPL/LGPL/commercial dual licensing. The surface mesh simplification package used by the STL reducer is GPL-3.0-or-later.
- [Eigen](https://eigen.tuxfamily.org/): MPL-2.0 (see its distribution for component-specific notices).

The Docker image also contains Node.js, Python and Debian libraries, including GMP and MPFR. Their licences and copyright notices are included by their distributions. JavaScript dependency versions are recorded in `package-lock.json`; native dependencies and build commands are in `Dockerfile`.

Contour Lab's own source is distributed under GPL-3.0-or-later, as described in README.md and LICENSE.
