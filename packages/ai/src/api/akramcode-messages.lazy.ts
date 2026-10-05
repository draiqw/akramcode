import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const akramCodeMessagesApi = (): ProviderStreams => lazyApi(() => import("./akramcode-messages.ts"));
