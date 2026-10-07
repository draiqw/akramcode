/**
 * Online Context Compact, ported from NVlabs/SoL-Pi (MIT).
 *
 * The model keeps its plan current through `update_plan`. When a registered step completes, the
 * extension prices a compaction (input saved over the projected remaining requests against the cost
 * of rewriting the prompt cache) and compacts at that safe point when it pays off, or when the
 * context nears the window. After compaction the task continues in a new turn.
 *
 * `update_plan` is registered inactive; enable it with `"defaultTools": ["+update_plan"]`.
 */

import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createOnlineContextCompactExtension } from "./extension.ts";

/** Ratio of cache-write to cache-read price used by SoL-Pi's defaults. */
export const DEFAULT_CACHE_WRITE_READ_RATIO = 12.5;

export { decideCompaction, estimateRemainingRequests } from "./economics.ts";
export {
	createOnlineContextCompactExtension,
	estimateNativeCompactionTokens,
	modelCacheWriteReadRatio,
} from "./extension.ts";

export function createOnlineCompactExtension(): ExtensionFactory {
	// Priced per model (for example GPT-6.1 Sol 25, GPT-6 Luna 12.5); SoL-Pi's fixed default when prices are unknown.
	return createOnlineContextCompactExtension({
		cacheWriteReadRatio: "model",
		fallbackCacheWriteReadRatio: DEFAULT_CACHE_WRITE_READ_RATIO,
	});
}

export default createOnlineCompactExtension();
