import { vi } from "vitest";

/** Enable network code paths for tests that replace external I/O with local fixtures or mocks. */
export function allowNetwork(): void {
	vi.stubEnv("AKRAMCODE_OFFLINE", undefined);
	vi.stubEnv("AKRAMCODE_VERSION_CHECK_URL", "https://updates.example.test/api/latest-version");
}
