import { resolve } from "node:path";

export interface AppConfig {
	DATABASE_PATH: string;
	ASSET_ROOT: string;
	ASSET_TEMP_ROOT?: string;
}

type ConfigEnvironment = Record<string, string | undefined>;

function requiredPath(
	environment: ConfigEnvironment,
	name: "DATABASE_PATH" | "ASSET_ROOT",
	cwd: string,
): string {
	const value = environment[name]?.trim();
	if (!value) {
		throw new Error(`${name} must be set`);
	}

	return resolve(cwd, value);
}

export function loadConfig(
	environment: ConfigEnvironment = process.env,
	cwd = process.cwd(),
): AppConfig {
	const tempRoot = environment.ASSET_TEMP_ROOT?.trim();

	return {
		DATABASE_PATH: requiredPath(environment, "DATABASE_PATH", cwd),
		ASSET_ROOT: requiredPath(environment, "ASSET_ROOT", cwd),
		...(tempRoot ? { ASSET_TEMP_ROOT: resolve(cwd, tempRoot) } : {}),
	};
}
