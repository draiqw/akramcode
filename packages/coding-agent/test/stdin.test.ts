import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readPipedStdin } from "../src/utils/stdin.ts";

function pipe(): PassThrough & NodeJS.ReadStream {
	return new PassThrough() as PassThrough & NodeJS.ReadStream;
}

describe("readPipedStdin", () => {
	it("returns undefined for a terminal", async () => {
		const stream = pipe();
		stream.isTTY = true;
		expect(await readPipedStdin(stream)).toBeUndefined();
	});

	it("gives up on an open, silent pipe once the start timeout passes", async () => {
		expect(await readPipedStdin(pipe(), 30)).toBeUndefined();
	});

	it("reads piped content to the end", async () => {
		const stream = pipe();
		const result = readPipedStdin(stream, 30);
		stream.write("hello ");
		stream.end("world\n");
		expect(await result).toBe("hello world");
	});

	it("keeps reading after the start timeout once data has begun to arrive", async () => {
		const stream = pipe();
		const result = readPipedStdin(stream, 30);
		stream.write("part one ");
		setTimeout(() => stream.end("part two"), 80);
		expect(await result).toBe("part one part two");
	});

	it("waits for the end when no start timeout is given", async () => {
		const stream = pipe();
		const result = readPipedStdin(stream);
		setTimeout(() => stream.end("late"), 60);
		expect(await result).toBe("late");
	});

	it("treats an empty pipe that ends as no input", async () => {
		const stream = pipe();
		const result = readPipedStdin(stream, 1000);
		stream.end();
		expect(await result).toBeUndefined();
	});
});
