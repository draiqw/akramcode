import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const mistralConversationsApi = (): ProviderStreams => lazyApi(() => import("./mistral-conversations.ts"));
