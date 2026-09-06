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

export async function printStartupLink(host: string, port: number) {
  const localHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::1" ? "[::1]" : host;
  const localUrl = `http://${localHost}:${port}/sessions`;
  console.log(`Web terminal: ${localUrl}`);
  try {
    let url: string | undefined;
    if (process.env.TERMINAL_PUBLIC_URL) {
      const configured = new URL(process.env.TERMINAL_PUBLIC_URL);
      if (!["http:", "https:"].includes(configured.protocol)) throw new Error("TERMINAL_PUBLIC_URL must be an HTTP(S) URL");
      if (configured.pathname === "/") configured.pathname = "/sessions";
      url = configured.href;
    } else {
      try {
        const { stdout } = await execFileAsync("tailscale", ["serve", "status", "--json"], { timeout: 3000 });
        url = tailscaleSessionsUrl(JSON.parse(stdout), port);
      } catch {}
    }
    console.log(url ? `Scan to open: ${url}` : "QR uses localhost; set TERMINAL_PUBLIC_URL or configure Tailscale Serve to open from your phone.");
    console.log(await QRCode.toString(url ?? localUrl, { type: "terminal", small: true }));
  } catch (error) {
    console.warn("Could not print startup QR code:", error instanceof Error ? error.message : error);
  }
}
