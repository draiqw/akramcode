import { defineService, type ReplicatedState } from "@akramcode/chord";
import type { ConversationView } from "@akramcode/durable";

/** The root conversation's durable view: active entries and its live, inbox, agent, and usage documents. */
export interface Transcript {
	readonly state: ReplicatedState<ConversationView>;
}

export const Transcript = defineService<Transcript>("akramcode.transcript");
