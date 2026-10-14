import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const openAICompletionsApi = (): ProviderStreams => lazyApi(() => import("./openai-completions.ts"));
