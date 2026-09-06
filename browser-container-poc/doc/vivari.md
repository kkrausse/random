# Vivari attempt

Implementation directory: `../vivari/`. Not implemented yet.

Goal: test whether browser-native JS execution delivers a responsive coding
workspace while preserving the real OpenCode host and useful tool semantics.

1. Pin Vivari and run the existing QEMU attempt's Vite fixture for comparison.
2. Measure cold preview, repeat reloads, and at least five warm edits, retaining
   individual timings and spikes.
3. Try the real OpenCode V2 SDK host: session creation, persistence, file tools,
   subprocesses, model streaming, and cancellation.
4. Record concrete Node/Bun compatibility gaps and bound the work to address them.
5. Consider the preserved Linux VM as a command backend if specific gaps justify
   it. Shared files, watch events, process routing, and networking require explicit
   integration; the two runtimes do not automatically share a filesystem.

Vivari runs JS through the browser engine with Node bindings and Bun API shims;
it does not execute our stock Bun/OpenCode Linux binaries. Compatibility and
performance for our workload remain unproven.
