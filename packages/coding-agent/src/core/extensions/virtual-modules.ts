import * as bundledAkramCodeAgentCore from "@akramcode/agent-core";
import * as bundledAkramCodeAiCompat from "@akramcode/providers/compat";
import * as bundledAkramCodeAiOauth from "@akramcode/providers/oauth";
import * as bundledAkramCodeAiProviders from "@akramcode/providers/providers/all";
import * as bundledAkramCodeTui from "@akramcode/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @akramcode/coding-agent.
import * as bundledAkramCodeCodingAgent from "../../index.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@akramcode/agent-core": bundledAkramCodeAgentCore,
	"@akramcode/tui": bundledAkramCodeTui,
	// Extensions resolve the akramcode-ai root to the compat entrypoint (a strict
	// superset of the core entrypoint): existing extensions using the old
	// global API keep working at runtime until compat is removed.
	"@akramcode/ai": bundledAkramCodeAiCompat,
	"@akramcode/providers/compat": bundledAkramCodeAiCompat,
	"@akramcode/providers/oauth": bundledAkramCodeAiOauth,
	"@akramcode/providers/providers/all": bundledAkramCodeAiProviders,
	"@akramcode/coding-agent": bundledAkramCodeCodingAgent,
	"@mariozechner/pi-agent-core": bundledAkramCodeAgentCore,
	"@mariozechner/pi-tui": bundledAkramCodeTui,
	"@mariozechner/pi-ai": bundledAkramCodeAiCompat,
	"@mariozechner/pi-ai/compat": bundledAkramCodeAiCompat,
	"@mariozechner/pi-ai/oauth": bundledAkramCodeAiOauth,
	"@mariozechner/pi-ai/providers/all": bundledAkramCodeAiProviders,
	"@mariozechner/pi-coding-agent": bundledAkramCodeCodingAgent,
};
