async function main() {
  console.log("checkpoint: importing SDK");
  const { OpenCode } = await import("@opencode-ai/sdk");
  const fs = await import("node:fs");
  const durable = process.env.OPENCODE_PROBE_DURABLE === "1";
  const recover = process.env.OPENCODE_PROBE_RECOVER === "1";
  console.log("checkpoint: creating host");
  const host = await OpenCode.create(durable ? { database: { path: "/opencode-packaged/host.sqlite" } } : undefined);
  try {
    console.log("checkpoint: creating session");
    const session = recover
      ? await host.sessions.get({ sessionID: fs.readFileSync("/opencode-packaged/session-id", "utf8") })
      : await host.sessions.create({ location: { directory: "/workspace" } });
    if (durable && !recover) fs.writeFileSync("/opencode-packaged/session-id", session.id);
    console.log("checkpoint: session created", session.id);
    const readback = await host.sessions.get({ sessionID: session.id });
    if (readback.id !== session.id) throw Error("Session readback mismatch");
    console.log("checkpoint: session readback", readback.id);
  } finally {
    await host.close();
    console.log("checkpoint: host closed");
  }
  console.log("checkpoint: host passed");
}
main().catch(error => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
