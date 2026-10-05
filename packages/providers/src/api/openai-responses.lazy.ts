import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const openAIResponsesApi = (): ProviderStreams => lazyApi(() => import("./openai-responses.ts"));
