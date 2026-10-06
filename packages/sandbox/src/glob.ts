/** Translate a glob (`*`, `**`, `?`, `{a,b}`, `[abc]`) into a regular expression over `/`-separated paths. */
export function globToRegExp(pattern: string): RegExp {
	let source = "";
	let braces = 0;
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i]!;
		if (char === "*") {
			if (pattern[i + 1] === "*") {
				i++;
				if (pattern[i + 1] === "/") {
					i++;
					source += "(?:.*/)?";
				} else {
					source += ".*";
				}
			} else {
				source += "[^/]*";
			}
		} else if (char === "?") {
			source += "[^/]";
		} else if (char === "{") {
			braces++;
			source += "(?:";
		} else if (char === "}" && braces > 0) {
			braces--;
			source += ")";
		} else if (char === "," && braces > 0) {
			source += "|";
		} else if (char === "[") {
			const end = pattern.indexOf("]", i + 1);
			if (end === -1) {
				source += "\\[";
			} else {
				source += pattern.slice(i, end + 1);
				i = end;
			}
		} else {
			source += char.replace(/[.+^$()|\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${source}$`);
}

/** A pattern without a `/` matches the file name at any depth, as in `fd` and gitignore. */
export function matchesGlob(pattern: string, relativePath: string): boolean {
	const regexp = globToRegExp(pattern);
	if (pattern.includes("/")) return regexp.test(relativePath);
	return regexp.test(relativePath.slice(relativePath.lastIndexOf("/") + 1));
}
