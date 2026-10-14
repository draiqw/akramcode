/**
 * Builds `DOMSnapshot.captureSnapshot` results and AX trees from a small element spec, so the
 * browser tests can feed recorded-shape CDP data without a browser.
 */

import type { CdpClient } from "../src/extensions/browser/cdp.ts";
import type { AxNode, CapturedSnapshot, SnapshotDocument } from "../src/extensions/browser/state.ts";

export interface FakeNode {
	id: number;
	tag?: string;
	text?: string;
	attrs?: Record<string, string>;
	/** x, y, width, height; default a visible 100x20 box at y = 10 * id. */
	box?: [number, number, number, number];
	display?: string;
	visibility?: string;
	opacity?: string;
	cursor?: string;
	value?: string;
	checked?: boolean;
	selected?: boolean;
	clickable?: boolean;
	/** No layout box (display: none). */
	noLayout?: boolean;
	role?: string;
	name?: string;
	axProps?: Record<string, unknown>;
	shadow?: boolean;
	children?: FakeNode[];
	/** Content document of an iframe. */
	frame?: FakeNode[];
}

export function buildSnapshot(
	body: FakeNode[],
	url = "https://example.test/page",
): {
	snapshot: CapturedSnapshot;
	ax: Map<number, AxNode>;
} {
	const strings: string[] = [];
	const intern = (value: string) => {
		const index = strings.indexOf(value);
		if (index >= 0) return index;
		strings.push(value);
		return strings.length - 1;
	};
	const ax = new Map<number, AxNode>();
	const documents: SnapshotDocument[] = [];

	const makeDocument = (children: FakeNode[], frameId: string, documentUrl: string, rootId: number): number => {
		const docIndex = documents.length;
		const doc: SnapshotDocument = {
			documentURL: intern(documentUrl),
			frameId: intern(frameId),
			nodes: {
				parentIndex: [],
				nodeType: [],
				nodeName: [],
				nodeValue: [],
				backendNodeId: [],
				attributes: [],
				inputValue: { index: [], value: [] },
				inputChecked: { index: [] },
				optionSelected: { index: [] },
				contentDocumentIndex: { index: [], value: [] },
				isClickable: { index: [] },
			},
			layout: { nodeIndex: [], styles: [], bounds: [], clientRects: [] },
		};
		documents.push(doc);
		const push = (parent: number, type: number, name: string, value: string, backendNodeId: number) => {
			doc.nodes.parentIndex.push(parent);
			doc.nodes.nodeType.push(type);
			doc.nodes.nodeName.push(intern(name));
			doc.nodes.nodeValue.push(value ? intern(value) : -1);
			doc.nodes.backendNodeId.push(backendNodeId);
			doc.nodes.attributes.push([]);
			return doc.nodes.parentIndex.length - 1;
		};
		const layout = (node: number, box: number[], styles: string[]) => {
			doc.layout.nodeIndex.push(node);
			doc.layout.bounds.push(box);
			doc.layout.styles.push(styles.map(intern));
			doc.layout.clientRects?.push([0, 0, box[2], box[3]]);
		};
		const root = push(-1, 9, "#document", "", rootId);
		layout(root, [0, 0, 1280, 800], ["block", "visible", "1", "auto"]);
		const add = (parent: number, spec: FakeNode) => {
			if (spec.tag === undefined) {
				const text = push(parent, 3, "#text", spec.text ?? "", spec.id);
				const box = spec.box ?? [0, spec.id * 10, 100, 20];
				if (!spec.noLayout) layout(text, box, ["inline", spec.visibility ?? "visible", "1", "auto"]);
				return;
			}
			const node = push(parent, 1, spec.tag.toUpperCase(), "", spec.id);
			const attrs = Object.entries(spec.attrs ?? {}).flatMap(([key, value]) => [intern(key), intern(value)]);
			doc.nodes.attributes[node] = attrs;
			if (spec.value !== undefined) {
				doc.nodes.inputValue?.index.push(node);
				doc.nodes.inputValue?.value.push(intern(spec.value));
			}
			if (spec.checked) doc.nodes.inputChecked?.index.push(node);
			if (spec.selected) doc.nodes.optionSelected?.index.push(node);
			if (spec.clickable) doc.nodes.isClickable?.index.push(node);
			if (!spec.noLayout) {
				layout(node, spec.box ?? [0, spec.id * 10, 100, 20], [
					spec.display ?? "block",
					spec.visibility ?? "visible",
					spec.opacity ?? "1",
					spec.cursor ?? "auto",
				]);
			}
			if (spec.role !== undefined || spec.name !== undefined || spec.axProps) {
				ax.set(spec.id, {
					backendDOMNodeId: spec.id,
					role: { value: spec.role ?? "generic" },
					name: { value: spec.name ?? "" },
					properties: Object.entries(spec.axProps ?? {}).map(([name, value]) => ({ name, value: { value } })),
				});
			}
			let childParent = node;
			if (spec.shadow) {
				childParent = push(node, 11, "#document-fragment", "", spec.id + 100_000);
			}
			for (const child of spec.children ?? []) add(childParent, child);
			if (spec.frame) {
				const childDoc = makeDocument(
					spec.frame,
					`frame-${spec.id}`,
					`${documentUrl}#frame-${spec.id}`,
					spec.id + 200_000,
				);
				doc.nodes.contentDocumentIndex?.index.push(node);
				doc.nodes.contentDocumentIndex?.value.push(childDoc);
			}
		};
		const html = push(root, 1, "HTML", "", rootId + 1);
		layout(html, [0, 0, 1280, 800], ["block", "visible", "1", "auto"]);
		const bodyNode = push(html, 1, "BODY", "", rootId + 2);
		layout(bodyNode, [0, 0, 1280, 800], ["block", "visible", "1", "auto"]);
		for (const child of children) add(bodyNode, child);
		return docIndex;
	};

	makeDocument(body, "main", url, 1_000_000);
	return { snapshot: { documents, strings }, ax };
}

export const VIEWPORT = { width: 1280, height: 800, scrollX: 0, scrollY: 0, pageWidth: 1280, pageHeight: 800 };

type Handler = (params: Record<string, unknown>, sessionId: string | undefined) => unknown;

/** A CDP client answering from per-method handlers and recording every call. */
export class FakeCdp implements CdpClient {
	readonly calls: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
	readonly handlers = new Map<string, Handler>();
	private readonly listeners = new Map<string, Set<(params: unknown, sessionId: string | undefined) => void>>();
	closed = false;

	async send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		const record = params as Record<string, unknown>;
		this.calls.push({ method, params: record, sessionId });
		const handler = this.handlers.get(method);
		if (!handler) return {} as T;
		return (await handler(record, sessionId)) as T;
	}

	on(method: string, handler: (params: unknown, sessionId: string | undefined) => void): () => void {
		const set = this.listeners.get(method) ?? new Set();
		set.add(handler);
		this.listeners.set(method, set);
		return () => set.delete(handler);
	}

	onClose(): () => void {
		return () => {};
	}

	close(): void {
		this.closed = true;
	}

	emit(method: string, params: unknown, sessionId?: string): void {
		for (const handler of this.listeners.get(method) ?? []) handler(params, sessionId);
	}

	methods(): string[] {
		return this.calls.map((call) => call.method);
	}
}
