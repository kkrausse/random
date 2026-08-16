import type { PlaybackSource } from "../lib/types";

export async function runGyroflow(
  executable: string,
  input: string,
  output: string,
  source: PlaybackSource,
  outputSize: { width: number; height: number } | undefined,
  signal: AbortSignal,
  trim?: { sourceIn: number; sourceOut: number; includeAudio?: boolean },
) {
  if (!(await Bun.file(executable).exists())) throw new Error(`Gyroflow CLI not found: ${executable}`);
  const outputParams = JSON.stringify({
    codec: "H.264/AVC",
    bitrate: source === "proxy" ? 20 : 60,
    use_gpu: true,
    audio: trim?.includeAudio ?? true,
    pixel_format: "YUV420P",
    ...(outputSize ? { output_width: outputSize.width, output_height: outputSize.height } : {}),
    output_path: output,
  });
  const args = [input, "-f", "-r", "apple m", "--stdout-progress", "-p", outputParams];
  if (trim) {
    args.push("--preset", JSON.stringify({
      version: 2,
      trim_ranges_ms: [[Math.round(trim.sourceIn * 1000), Math.round(trim.sourceOut * 1000)]],
    }));
  }
  const process = Bun.spawn([executable, ...args], { stdout: "pipe", stderr: "pipe" });
  const abort = () => process.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (signal.aborted) throw new Error("Stabilization cancelled");
    const log = `${stderr}\n${stdout}`.trim();
    if (exitCode !== 0 || log.includes("Rendering failed:")) {
      throw new Error(`Gyroflow failed: ${log || `exit code ${exitCode}`}`);
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
