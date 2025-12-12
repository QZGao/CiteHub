/**
 * Represents a single usage of a reference in the document.
 */
export interface ReferenceUse {
	/** Zero-based index of this use among all uses of the parent reference. */
	index: number;
	/** DOM element (typically an anchor) corresponding to this use, if found. */
	anchor: Element | null;
}

/**
 * Represents a citation reference extracted from wikitext.
 */
export interface Reference {
	/** Unique identifier for the reference (name or generated key). */
	id: string;
	/** The `name` attribute of the ref tag, or null if unnamed. */
	name: string | null;
	/** The `group` attribute of the ref tag, or null if not grouped. */
	group: string | null;
	/** The wikitext content inside the ref tag. */
	contentWikitext: string;
	/** All uses (invocations) of this reference in the document. */
	uses: ReferenceUse[];
}

/**
 * Represents a queued change to a reference name.
 */
export interface PendingChange {
	/** ID of the reference being changed. */
	refId: string;
	/** Original name before the change. */
	oldName: string;
	/** New name after the change. */
	newName: string;
}

/**
 * Internal state for the inspector panel Vue component.
 */
export interface InspectorState {
	open: boolean;
	visible: boolean;
	refs: Reference[];
	selectedRef: Reference | null;
	query: string;
	settings: {
		copyFormat: 'raw' | 'r' | 'ref';
		showCiteRefCopyBtn: boolean;
		showInUserNs: boolean;
		placementMode: 'all_inline' | 'all_ldr' | 'threshold';
		minUsesForLdr: number;
		sortRefs: boolean;
		useTemplateR: boolean;
		makeCopies: boolean;
		normalizeAll: boolean;
	};
	showSettings: boolean;
	minHeight: number;
	pendingChanges: PendingChange[];
	/** ID of the reference currently being edited inline, or null if none. */
	editingRefId: string | null;
}

/**
 * Extended context including computed properties for the inspector.
 */
export type InspectorCtx = InspectorState & {
	sortedRefs: Reference[];
	filteredRefs: Reference[];
	firstByBucket: Record<string, string>;
	hasPendingChanges: boolean;
	hasRefs: boolean;
	nameConflicts: Set<string>;
	hasConflicts: boolean;
};
