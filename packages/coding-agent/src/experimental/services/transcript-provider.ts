import { type Context, defineFacet, type Facet } from "@akramcode/chord";
import type { Conversation } from "@akramcode/durable";
import { Transcript } from "./transcript.ts";

/** Serve the conversation's durable view state. The facet owns and disposes the attached state. */
export async function createTranscriptServiceFacet(conversation: Conversation, context: Context): Promise<Facet> {
	const state = await conversation.viewState(context);
	return defineFacet({
		id: "@akramcode/transcript",
		setup(env) {
			env.own(() => state.dispose());
			env.provide(Transcript, { state });
		},
	});
}
