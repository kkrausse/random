import { randomBytes } from "node:crypto";

export type Credentials = { secret: string; signingKey: string };

export function generateCredentials(): Credentials {
  return { secret: randomBytes(32).toString("base64url"), signingKey: randomBytes(32).toString("base64url") };
}

export function decodeCredentials(value: string): Credentials {
  const invalid = () => new Error("Invalid PicSync Keychain credentials. Stop the server and run bun run auth:reset.");
  let data;
  try {
    data = JSON.parse(Buffer.from(value.trim(), "base64").toString("utf8"));
  } catch {
    throw invalid();
  }
  const valid = (key: unknown): key is string => typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key)
    && Buffer.from(key, "base64url").toString("base64url") === key;
  if (data?.version !== 1 || !valid(data.secret) || !valid(data.signingKey)) throw invalid();
  return { secret: data.secret, signingKey: data.signingKey };
}

function identity(port: number) {
  if (process.platform !== "darwin") throw new Error("PicSync credential storage requires macOS Keychain.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PicSync port.");
  return ["-s", "picsync-web.auth.v1", "-a", `port-${port}`];
}

async function security(args: string[], input?: string) {
  const child = Bun.spawn(["/usr/bin/security", ...args], {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout };
}

export async function loadCredentials(port: number): Promise<Credentials> {
  const id = identity(port);
  const read = () => security(["find-generic-password", ...id, "-w"]);
  const existing = await read();
  if (existing.code === 0) return decodeCredentials(existing.stdout);
  if (existing.code !== 44) throw new Error("Cannot access PicSync credentials in macOS Keychain. Unlock your login keychain and retry.");
  const encoded = Buffer.from(JSON.stringify({ version: 1, ...generateCredentials() })).toString("base64");
  // Secrets go through stdin, not process arguments. Do not overwrite a concurrent creator.
  await security(["-i"], `add-generic-password ${id.join(" ")} -w ${encoded}\n`);
  const saved = await read();
  if (saved.code !== 0) throw new Error("Could not save PicSync credentials in macOS Keychain.");
  return decodeCredentials(saved.stdout);
}

export async function resetCredentials(port: number) {
  const result = await security(["delete-generic-password", ...identity(port)]);
  if (result.code !== 0 && result.code !== 44) throw new Error("Could not reset PicSync credentials in macOS Keychain.");
}
