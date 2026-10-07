/**
 * Turns a build spec into the argv prefix that starts akramcode.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildSpec } from "./config.ts";

export interface ResolvedBuild {
	/** argv prefix; the harness appends akramcode arguments. */
	command: string[];
	/** Human-readable identity, e.g. version or commit. */
	label: string;
}

export interface BuildContext {
	cacheDir: string;
	/** Repository that `ref:` builds are checked out from and that provides node_modules. */
	repoRoot: string;
	releaseRepo: string;
	log: (message: string) => void;
}

function run(command: string, args: string[], cwd?: string): string {
	return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function versionOf(command: string[]): string {
	try {
		return run(command[0], [...command.slice(1), "--version"]);
	} catch {
		return "unknown";
	}
}

function sourceCommand(dir: string): string[] {
	const root = resolve(dir);
	const cli = join(root, "packages/coding-agent/src/cli.ts");
	if (!existsSync(cli)) throw new Error(`${root} is not an akramcode source checkout (missing ${cli})`);
	if (!existsSync(join(root, "node_modules"))) {
		throw new Error(`${root} has no node_modules. Install dependencies before using it as a source build.`);
	}
	if (!existsSync(join(root, "packages/providers/src/providers/data/.manifest.json"))) {
		throw new Error(`${root} has no hydrated model data. Run "npm run hydrate:model-data" there first.`);
	}
	const resolver = join(root, "packages/coding-agent/src/experimental/source-resolver.ts");
	const command = [process.execPath];
	if (existsSync(resolver)) command.push("--import", pathToFileURL(resolver).href);
	command.push(cli);
	return command;
}

function releaseAsset(dir: string): string {
	const assets = readdirSync(dir).filter((name) => name.endsWith(".tar.gz"));
	const platform = `${process.platform}-${process.arch}`;
	const asset = assets.find((name) => name.includes(platform)) ?? (assets.length === 1 ? assets[0] : undefined);
	if (!asset) throw new Error(`No release asset for ${platform} in ${dir}: ${assets.join(", ") || "none"}`);
	return asset;
}

function resolveRelease(tag: string, context: BuildContext): string[] {
	const dir = join(context.cacheDir, "releases", tag);
	const binary = join(dir, "akramcode", "akramcode");
	if (!existsSync(binary)) {
		mkdirSync(dir, { recursive: true });
		context.log(`downloading release ${tag} from ${context.releaseRepo}`);
		run("gh", ["release", "download", tag, "-R", context.releaseRepo, "-p", "*.tar.gz", "--clobber"], dir);
		run("tar", ["xzf", releaseAsset(dir)], dir);
		if (!existsSync(binary)) throw new Error(`Release ${tag} did not contain akramcode/akramcode`);
	}
	return [binary];
}

/** Copies a directory, using copy-on-write clones where the platform supports them. */
function cloneDir(from: string, to: string): void {
	if (process.platform === "darwin") execFileSync("cp", ["-Rc", from, to]);
	else cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

function resolveRef(ref: string, context: BuildContext): string[] {
	const sha = run("git", ["rev-parse", "--verify", `${ref}^{commit}`], context.repoRoot);
	const dir = join(context.cacheDir, "refs", sha);
	if (!existsSync(join(dir, "packages/coding-agent/src/cli.ts"))) {
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(join(context.cacheDir, "refs"), { recursive: true });
		context.log(`creating worktree for ${ref} (${sha.slice(0, 10)})`);
		run("git", ["worktree", "add", "--detach", dir, sha], context.repoRoot);
		// Dependencies come from the current checkout; refs whose lockfile differs need a manual install.
		cloneDir(join(context.repoRoot, "node_modules"), join(dir, "node_modules"));
		for (const name of readdirSync(join(context.repoRoot, "packages"))) {
			const modules = join(context.repoRoot, "packages", name, "node_modules");
			if (existsSync(modules) && existsSync(join(dir, "packages", name))) {
				cloneDir(modules, join(dir, "packages", name, "node_modules"));
			}
		}
		const data = join(context.repoRoot, "packages/providers/src/providers/data");
		if (existsSync(data)) cloneDir(data, join(dir, "packages/providers/src/providers/data"));
	}
	return sourceCommand(dir);
}

export function resolveBuild(build: BuildSpec, context: BuildContext): ResolvedBuild {
	let command: string[];
	let label: string;
	switch (build.kind) {
		case "release":
			command = resolveRelease(build.tag, context);
			label = `release ${build.tag}`;
			break;
		case "binary": {
			const path = resolve(build.path);
			if (!existsSync(path)) throw new Error(`Binary not found: ${path}`);
			command = [path];
			label = `binary ${path}`;
			break;
		}
		case "source": {
			command = sourceCommand(build.dir);
			let commit = "unknown";
			try {
				commit = run("git", ["rev-parse", "--short", "HEAD"], build.dir);
				if (run("git", ["status", "--porcelain", "--untracked-files=no"], build.dir)) commit += "+dirty";
			} catch {}
			label = `source ${resolve(build.dir)} @ ${commit}`;
			break;
		}
		case "ref":
			command = resolveRef(build.ref, context);
			label = `ref ${build.ref}`;
			break;
	}
	return { command, label: `${label} (${versionOf(command)})` };
}
