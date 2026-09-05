import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { openpty } from "xterm-pty";
import "./runtime.css";

type EmscriptenModule = {
  arguments: string[];
  locateFile: (path: string) => string;
  mainScriptUrlOrBlob: string;
  preRun: Array<(module: EmscriptenModule & { FS: { mkdir(path: string): void } }) => void>;
  pty?: unknown;
  TTY?: { stream_ops: { poll: (stream: unknown, timeout: number) => number } };
};

declare global {
  var Module: EmscriptenModule;
}

const sendStatus = (status: "loading" | "running" | "error", detail: string) => {
  window.parent.postMessage({ source: "qemu-runtime", status, detail }, window.location.origin);
};

async function boot() {
  sendStatus("loading", "Preparing terminal and starting the QEMU worker…");

  const terminal = new Terminal({
    cols: 100,
    rows: 30,
    cursorBlink: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    theme: { background: "#111318", foreground: "#e7e9ee", cursor: "#ffffff" },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(document.getElementById("terminal")!);
  fit.fit();

  const { master, slave } = openpty();
  terminal.loadAddon(master);

  const assetRoot = `${window.location.origin}/qemu/`;
  Module.arguments = [
    "-nographic", "-M", "pc", "-m", "512M", "-accel", "tcg,tb-size=500",
    "-L", "/pack-rom/", "-nic", "none",
    "-kernel", "/pack-kernel/vmlinuz-virt",
    "-initrd", "/pack-initramfs/initramfs-virt",
    "-append", "console=ttyS0 root=/dev/vda noautodetect hostname=demo",
    "-drive", "id=rootfs,file=/pack-rootfs/disk-rootfs.img,format=raw,if=none",
    "-device", "virtio-blk-pci,drive=rootfs",
  ];
  Module.locateFile = (path) => assetRoot + path;
  Module.mainScriptUrlOrBlob = assetRoot + "out.js";
  Module.pty = slave;

  const resize = () => fit.fit();
  window.addEventListener("resize", resize);

  const { default: initQemu } = await import(/* @vite-ignore */ assetRoot + "out.js");
  const instance = (await initQemu(Module)) as EmscriptenModule;

  if (instance.TTY) {
    const oldPoll = instance.TTY.stream_ops.poll;
    instance.TTY.stream_ops.poll = (stream, timeout) => {
      if (!slave.readable) return (slave.readable ? 1 : 0) | (slave.writable ? 4 : 0);
      return oldPoll.call(instance.TTY!.stream_ops, stream, timeout);
    };
  }
  sendStatus("running", "QEMU started. Linux boot output is available in the serial console.");
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  sendStatus("error", message);
  document.body.innerHTML = `<pre class="fatal">VM failed to start\n\n${message}</pre>`;
});
