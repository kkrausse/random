export async function requireFfmpegEncoder(configuredPath: string, encoder: string) {
  const requestedPath = process.env.FFMPEG_PATH ?? configuredPath;
  const path = Bun.which(requestedPath) ?? requestedPath;
  const subprocess = Bun.spawn([path, "-hide_banner", "-encoders"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`FFmpeg is unavailable at ${path}: ${stderr.trim() || `exit code ${exitCode}`}`);
  }
  if (!new RegExp(`\\b${encoder}\\b`).test(stdout)) {
    throw new Error(`FFmpeg at ${path} does not provide the required ${encoder} encoder`);
  }
  return path;
}
