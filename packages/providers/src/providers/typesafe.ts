import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { typesafeSystemOneApi } from "../api/typesafe-system-one.lazy.ts";
import { TYPESAFE_CLASSIFIER_MODELS } from "./typesafe.models.ts";

export function typesafeProvider(): Provider {
	return createProvider({
		id: "typesafe",
		name: "TypeSafe",
		auth: {
			apiKey: envApiKeyAuth("TypeSafe API key", ["TYPESAFE_API_KEY"]),
		},
		models: Object.values(TYPESAFE_CLASSIFIER_MODELS),
		classifiers: {
			"typesafe-system-one": typesafeSystemOneApi(),
		},
	});
}
