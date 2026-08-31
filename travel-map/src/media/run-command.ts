import { MediaPipelineError } from "./errors";

export async function runCommand(
	argv: string[],
	options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ stdout: Uint8Array; stderr: string }> {
	let process: ReturnType<typeof Bun.spawn>;
	try {
		process = Bun.spawn(argv, {
			cwd: options.cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (error) {
		throw new MediaPipelineError(
			"missing-tool",
			`Required media tool ${argv[0]} is not available.`,
			String(error),
		);
	}

	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timeout = setTimeout(
			() => {
				process.kill();
				reject(
					new MediaPipelineError(
						"processing-failed",
						"Media processing timed out.",
						argv.join(" "),
					),
				);
			},
			options.timeoutMs ?? 30 * 60 * 1000,
		);
	});

	try {
		const [stdout, stderr, exitCode] = await Promise.race([
			Promise.all([
				new Response(process.stdout as ReadableStream<Uint8Array>).bytes(),
				new Response(process.stderr as ReadableStream<Uint8Array>).text(),
				process.exited,
			]),
			timedOut,
		]);
		if (exitCode !== 0) {
			throw new MediaPipelineError(
				"processing-failed",
				"A media processing tool could not read this file.",
				`${argv.join(" ")}\n${stderr.slice(0, 4_000)}`,
			);
		}
		return { stdout, stderr };
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
