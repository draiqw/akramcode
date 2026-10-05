import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const akramCodeMessagesApi = (): ProviderStreams => lazyApi(() => import("./akramcode-messages.ts"));
