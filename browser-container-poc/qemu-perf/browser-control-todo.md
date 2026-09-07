# Browser Control observation

- Version: Bun-backed `browser-control v0.7.0`.
- Session: `gentle-otter-329`, owned isolated `http://127.0.0.1:5198/` workspace;
  QEMU runtime and guest preview child frames.
- At 2026-09-07 04:17 UTC, a long `page.frames()[1].evaluate()` awaiting a guest
  bridge command failed with `Execution context was destroyed, most likely
  because of a navigation.` Diagnostic: `execution-context/context-destroyed;
  pageClosed=false; urlChanged=false; mainFrameNavigations=0`.
- Reproduction: start guest Vite in this isolated VM, connect preview, stop and
  restart owned guest Vite while preview reconnects, then await a bounded guest
  shell loop reading its startup log through `guestBridge.request({type:'exec'})`.
- Expected: guest-runtime evaluation remains attached when a sibling preview
  navigates/reconnects. Actual: CLI reported context destruction and
  `connected:false`; the guest command continued running.
- Recovery: one short execute enumerated the same workspace/runtime/preview URLs;
  a subsequent short guest command worked, and original VM/bridge state remained.
  No relay restart, navigation, tab reset or replacement was requested. Use short
  observations while Vite restarts. No credentials were involved.
- Follow-up: determine whether sibling-frame navigation or transient extension
  attachment produced the error. This spike does not establish the cause.
- The first post-restart edit at host epoch `1788755093340` also overlapped a
  pending preview navigation and reported context destruction. Its guest write
  survived, but the page-evaluation `finally` restoration did not. A fresh short
  command restored the exact original heading and verified the original SHA-256.
  The own profiling wrapper now retains recovery data outside page evaluation
  and attempts independent verified restoration on failure. No failed sample is
  presented as successful HMR or as a reload timing.
