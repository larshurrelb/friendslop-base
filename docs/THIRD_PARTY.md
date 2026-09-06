# Third-party materials

Repository-owned application code, procedural models, and synthesized audio are
released under the repository [MIT License](../LICENSE).

## Files distributed with the client

- **DM Sans** and **Space Grotesk** are distributed under the SIL Open Font
  License 1.1. The WOFF2 files and complete license texts are in
  `public/fonts/`.
- **libopus-wasm 0.2.0** is an MIT-licensed wrapper. Its compiled WebAssembly
  contains **libopus 1.6.1**, distributed under a BSD-style license. The wrapper
  license and the complete libopus notice are in `public/licenses/` and are
  copied into production builds.
- **Three.js, Rapier, PeerJS, and PeerJS's browser dependencies** are compiled
  into the client JavaScript. Their complete MIT, Apache-2.0, ISC, and BSD
  license texts are consolidated in
  `public/licenses/client-dependencies-LICENSES.txt`.

Keep those license and notice files with any redistributed client build.

## Package dependencies

Production dependencies are installed from npm and retain their own licenses:

| Package | License |
| --- | --- |
| Three.js | MIT |
| `@dimforge/rapier3d-compat` | Apache-2.0 |
| PeerJS | MIT |
| `ws` | MIT |
| `sirv` | MIT |
| `libopus-wasm` | MIT; bundled libopus is BSD-style |

The development toolchain includes TypeScript and Playwright (Apache-2.0) and
Vite, tsx, PeerServer, and type packages (MIT). Transitive packages recorded in
`package-lock.json` report MIT, Apache-2.0, BSD-3-Clause, or ISC licenses. A
redistributor who vendors `node_modules` should preserve the license files from
those packages as well.

## External services

The default configuration uses Google's public STUN servers and the public
PeerJS broker for WebRTC connection setup. They are services, not code or assets
included in this repository. Operators may replace them in `public/config.json`
or server configuration and are responsible for the terms and privacy notices
that apply to the services they choose.

This inventory is provided for practical compliance help, not as legal advice.
