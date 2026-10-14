import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileLeaseStore } from "../src/lease.ts";
import { sweepVolumes, type VolumeClient, VolumeLedger } from "../src/volumes.ts";

describe("FileLeaseStore", () => {
	it("is held once and released", () => {
		const store = new FileLeaseStore(mkdtempSync(join(tmpdir(), "akc-lease-")));
		expect(store.tryAcquire("s1")).toBe(true);
		expect(store.tryAcquire("s1")).toBe(true);
		store.release("s1");
		expect(store.tryAcquire("s1")).toBe(true);
	});

	it("is refused while a live process holds it and taken over when that process is gone", () => {
		const dir = mkdtempSync(join(tmpdir(), "akc-lease-"));
		const store = new FileLeaseStore(dir);
		writeFileSync(join(dir, "s2.lease"), String(process.ppid));
		expect(store.tryAcquire("s2")).toBe(false);
		writeFileSync(join(dir, "s3.lease"), "2147483646");
		expect(store.tryAcquire("s3")).toBe(true);
	});
});

describe("volume sweep", () => {
	it("deletes stale volumes and keeps the ones still in use", async () => {
		const ledger = new VolumeLedger(join(mkdtempSync(join(tmpdir(), "akc-vol-")), "volumes.json"));
		const day = 86_400_000;
		const now = 100 * day;
		ledger.touch("old", now - 40 * day);
		ledger.touch("busy", now - 41 * day);
		ledger.touch("fresh", now - day);
		const client: VolumeClient = { remove: async (name) => (name === "busy" ? "in-use" : "deleted") };
		const result = await sweepVolumes(ledger, client, 30, now);
		expect(result.deleted).toEqual(["old"]);
		expect(result.skipped).toEqual(["busy"]);
		expect(ledger.stale(now - 30 * day)).toEqual(["busy"]);
	});
});
