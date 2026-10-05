import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const azureOpenAIResponsesApi = (): ProviderStreams => lazyApi(() => import("./azure-openai-responses.ts"));
