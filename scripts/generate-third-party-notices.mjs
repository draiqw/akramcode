#!/usr/bin/env node
// Writes THIRD_PARTY_NOTICES.md for the standalone release: the notice of the upstream project
// akramcode derives from, then the license text of every package in the coding-agent shrinkwrap.
// Usage: node scripts/generate-third-party-notices.mjs <output file>

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2];
if (!output) {
	console.error("Usage: node scripts/generate-third-party-notices.mjs <output file>");
	process.exit(1);
}

const UPSTREAM = `## pi

akramcode is derived from pi (https://github.com/earendil-works/pi).

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;
const shrinkwrap = JSON.parse(readFileSync(join(root, "packages/coding-agent/npm-shrinkwrap.json"), "utf-8"));

// Shrinkwrap paths are relative to packages/coding-agent; npm hoists most of them to the repository root.
function findPackageDir(path) {
	for (const base of [join(root, "packages/coding-agent"), root]) {
		const dir = join(base, path);
		if (existsSync(join(dir, "package.json"))) return dir;
	}
	return undefined;
}

function describe(dir) {
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
	const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
	const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
	return [author && `Author: ${author}`, repository && `Repository: ${repository}`].filter(Boolean).join("\n");
}

const sections = [];
for (const [path, info] of Object.entries(shrinkwrap.packages)) {
	if (!path || info.link) continue;
	const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
	if (name.startsWith("@akramcode/")) continue;
	const header = `## ${name}@${info.version}\n\nLicense: ${info.license ?? "see below"}`;
	const dir = findPackageDir(path);
	// Optional platform packages of other platforms are not installed here; their license field still applies.
	if (!dir) {
		sections.push(`${header}\n`);
		continue;
	}
	const files = readdirSync(dir).filter((file) => LICENSE_FILE.test(file));
	// Some packages ship without a license file; name the author and source so the notice is attributable.
	const body =
		files.length > 0 ? files.map((file) => readFileSync(join(dir, file), "utf-8").trim()).join("\n\n") : describe(dir);
	sections.push(`${header}\n\n${body}\n`);
}

// Code adapted into workspace packages keeps its license under packages/<name>/LICENSES/.
for (const pkg of readdirSync(join(root, "packages"))) {
	const dir = join(root, "packages", pkg, "LICENSES");
	if (!existsSync(dir)) continue;
	for (const file of readdirSync(dir)) {
		const text = readFileSync(join(dir, file), "utf-8").trim();
		sections.push(`## ${file.replace(/\.txt$/, "")} (adapted in @akramcode/${pkg})\n\n${text}\n`);
	}
}

writeFileSync(
	output,
	`# Third-party notices\n\nakramcode includes the following third-party software.\n\n${UPSTREAM}\n${sections.join("\n")}`,
);
console.log(`Wrote ${output} (${sections.length + 1} entries).`);
