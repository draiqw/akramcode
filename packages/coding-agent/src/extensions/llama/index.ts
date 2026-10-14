import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { createLlamaProvider } from "./provider.ts";

export default function llamaExtension(akramcode: ExtensionAPI): void {
	akramcode.registerProvider(createLlamaProvider().provider);
}
