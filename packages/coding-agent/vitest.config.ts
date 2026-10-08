import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
			// Trace capture stays off unless a test installs a recorder itself.
			env: { AKRAMCODE_OFFLINE: "1", AKRAMCODE_TRACES: "0" },
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
		resolve: {
			alias: [
				{ find: /^@akramcode\/ai$/, replacement: workspaceSourcePaths.aiIndex },
				{ find: /^@akramcode\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			],
		},
	}),
);
