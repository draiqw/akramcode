import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const googleGenerativeAIApi = (): ProviderStreams => lazyApi(() => import("./google-generative-ai.ts"));
