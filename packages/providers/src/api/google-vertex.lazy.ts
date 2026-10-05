import { lazyApi } from "@akramcode/ai/api/lazy";
import type { ProviderStreams } from "@akramcode/ai/types";

export const googleVertexApi = (): ProviderStreams => lazyApi(() => import("./google-vertex.ts"));
