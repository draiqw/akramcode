export function getAkramCodeUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `akramcode/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
