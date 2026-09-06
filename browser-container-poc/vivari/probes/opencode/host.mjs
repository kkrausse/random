console.log("checkpoint: importing SDK");
const { OpenCode } = await import("@opencode-ai/sdk");
console.log("checkpoint: creating host");
const host = await OpenCode.create();
try {
  console.log("checkpoint: creating session");
  const session = await host.sessions.create({ location: { directory: "/workspace" } });
  console.log("checkpoint: session created", session.id);
} finally {
  await host.close();
}
