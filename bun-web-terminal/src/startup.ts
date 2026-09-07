import { execFile } from "node:child_process";
import { promisify } from "node:util";
import QRCode from "qrcode";

const execFileAsync = promisify(execFile);

// Only advertise a root Serve route that actually forwards to this instance.
export function tailscaleSessionsUrl(status: unknown, port: number): string | undefined {
  const web = (status as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> } | null)?.Web;
  if (!web || typeof web !== "object") return;
  for (const [address, config] of Object.entries(web)) {
    const proxy = config?.Handlers?.["/"]?.Proxy;
    if (typeof proxy !== "string") continue;
    try {
      const target = new URL(proxy);
      if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) continue;
      if (Number(target.port || 80) !== port || target.pathname !== "/" || target.search) continue;
      const url = new URL(`https://${address}/sessions`);
      const tcp = (status as { TCP?: Record<string, { HTTPS?: boolean }> }).TCP;
      if (!tcp?.[url.port || "443"]?.HTTPS) continue;
      return url.href;
    } catch {}
  }
}

export async function publicSessionsUrl(port: number): Promise<string | undefined> {
  if (process.env.TERMINAL_PUBLIC_URL) {
    const url = new URL(process.env.TERMINAL_PUBLIC_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/sessions"].includes(url.pathname)) {
      throw new Error("TERMINAL_PUBLIC_URL must be an HTTPS origin or /sessions URL without credentials, query, or fragment");
    }
    url.pathname = "/sessions";
    return url.href;
  }
  try {
    const { stdout } = await execFileAsync("tailscale", ["serve", "status", "--json"], { timeout: 3000 });
    return tailscaleSessionsUrl(JSON.parse(stdout), port);
  } catch {}
}

export function signInUrl(sessionsUrl: string, secret: string) {
  const url = new URL("/login", sessionsUrl);
  url.hash = new URLSearchParams({ key: secret }).toString();
  return url.href;
}

export async function printStartupLink(host: string, port: number, secret: string, publicUrl?: string) {
  const localHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::1" ? "[::1]" : host;
  const localUrl = `http://${localHost}:${port}/sessions`;
  console.log(`Web terminal: ${localUrl}`);
  console.log(`Mac sign-in: ${signInUrl(localUrl, secret)}`);
  console.log("Sign-in links grant terminal access. Restart Bun to rotate the secret and revoke all sessions.");
  try {
    const url = signInUrl(publicUrl ?? localUrl, secret);
    console.log(publicUrl ? `Phone sign-in (scan below): ${url}` : "QR uses localhost; set TERMINAL_PUBLIC_URL or configure Tailscale Serve to open from your phone.");
    console.log(await QRCode.toString(url, { type: "terminal", small: true }));
  } catch (error) {
    console.warn("Could not print startup QR code:", error instanceof Error ? error.message : error);
  }
}
