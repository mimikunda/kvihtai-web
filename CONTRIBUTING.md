# Contributing to KvihtAI Web

This repository is the zero-install dashboard for the KvihtAI station. It serves as a lightweight diagnostic viewer that loads instantly on gym WiFi.

## 1. Architectural Boundaries
- **Zero Bloat:** Do not introduce heavy frontend frameworks (React, Angular) or heavy state management libraries. Use Vanilla TypeScript, Vite, or a similarly lightweight compiler.
- **Performance:** 2D bar paths and velocity curves must render smoothly on mid-range mobile browsers. Utilize the HTML5 Canvas API for telemetry plotting.
- **Network Scope:** This client only communicates with the local `kvihtai-core` daemon. Do not add cloud telemetry, external analytics, or remote CDNs.

## 2. Assisted Synthesis & LLM Usage
If utilizing AI to generate web logic:
1. **Bundle Size:** Ensure the LLM does not import massive libraries (e.g., full D3.js, Lodash) for simple math or charting that can be done natively.
2. **WebSocket Logic:** Verify that generated WebSocket consumers handle high-frequency coordinate updates efficiently without trashing the DOM or blocking the main thread.
3. **Verification:** You must understand the DOM updates and memory lifecycle of the generated code.

## 3. Git & Branching Protocol
1. **Branch Naming:** `feat/canvas-renderer`, `feat/ws-client`, `fix/layout-shift`.
2. **Commit Policy:** Keep UI styling changes and network logic changes in separate commits.
3. **PR Merging:** The build must succeed (`npm run build`) without TypeScript compiler errors before requesting a review.
