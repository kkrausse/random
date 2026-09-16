import { networkInterfaces } from "node:os";

const interfaces = Object.entries(networkInterfaces()).sort(([a], [b]) =>
  (a === "en0" ? -1 : b === "en0" ? 1 : a.localeCompare(b)));
const candidates = interfaces.flatMap(([, addresses]) => addresses ?? []).filter(info =>
  info.family === "IPv4" && !info.internal &&
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(info.address));
const address = process.env.LAN_IP
  ? candidates.find(info => info.address === process.env.LAN_IP)
  : candidates[0];
if (!address?.cidr) throw new Error("No private LAN IPv4 address found. Connect to Wi-Fi/Ethernet or set LAN_IP to an address on this Mac.");
const prefix = Number(address.cidr.split("/")[1]);
const ip = address.address.split(".").reduce((n, part) => (n << 8) | Number(part), 0);
const network = (ip & (-1 << (32 - prefix))) >>> 0;
process.env.PORT ??= "8794";
process.env.HOST = "0.0.0.0";
process.env.LAN_CIDR = `${[24, 16, 8, 0].map(shift => (network >>> shift) & 255).join(".")}/${prefix}`;
process.env.PICSYNC_LAN_URL = `http://${address.address}:${process.env.PORT}`;
delete process.env.PICSYNC_PUBLIC_URL;
delete process.env.TLS_CERT;
delete process.env.TLS_KEY;
console.log(`PicSync LAN: ${process.env.PICSYNC_LAN_URL} · allowed ${process.env.LAN_CIDR} and localhost`);
await import("./server");
