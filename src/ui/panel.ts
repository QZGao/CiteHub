import { Reference, InspectorState, InspectorCtx } from '../types';
import {
	createDialogMountIfNeeded,
	getMountedApp,
	getMountedRoot,
	loadCodexAndVue,
	mountApp,
	registerCodexComponents
} from './codex';
import { getSettings, namespaceAllowed, saveSettings } from './settings';
import { initCitationPopup } from './citations';
import panelStyles from './panel.css';
import PANEL_TEMPLATE from './panel.template.vue';

const PANEL_STYLE_ELEMENT_ID = 'citehub-panel-styles';
const HIGHLIGHT_CLASS = 'citehub-ref-highlight';
const PORTLET_LINK_ID = 'citehub-portlet-link';
const PANEL_SIZE_KEY = 'citehub-panel-size';

let panelStylesInjected = false;

/**
 * Inject panel styles into the document once.
 */
function injectPanelStyles(): void {
	if (panelStylesInjected) return;
	const existing = document.getElementById(PANEL_STYLE_ELEMENT_ID);
	if (existing) {
		panelStylesInjected = true;
		return;
	}
	try {
		const styleEl = document.createElement('style');
		styleEl.id = PANEL_STYLE_ELEMENT_ID;
		styleEl.appendChild(document.createTextNode(panelStyles));
		document.head.appendChild(styleEl);
		panelStylesInjected = true;
	} catch {
		const div = document.createElement('div');
		div.innerHTML = `<style id="${PANEL_STYLE_ELEMENT_ID}">${panelStyles}</style>`;
		const styleEl = div.firstChild as HTMLElement | null;
		if (styleEl) {
			document.head.appendChild(styleEl);
			panelStylesInjected = true;
		}
	}
}

/**
 * Highlight all DOM anchors associated with a reference.
 * Clears any existing highlights before applying new ones.
 * Scrolls to the first anchor and triggers a blink animation.
 * @param ref - The reference to highlight, or null to clear all.
 */
function highlightRef(ref: Reference | null): void {
	clearHighlights();
	if (!ref) return;
	const anchors: Element[] = [];
	ref.uses.forEach((use) => {
		if (use.anchor) {
			use.anchor.classList.add(HIGHLIGHT_CLASS);
			use.anchor.classList.add('citehub-ref-blink');
			anchors.push(use.anchor);
		}
	});
	// Scroll to the first highlighted anchor
	if (anchors.length > 0) {
		anchors[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
}

/**
 * Remove all reference highlight styling from the document.
 */
export function clearHighlights(): void {
	document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
		node.classList.remove(HIGHLIGHT_CLASS);
		node.classList.remove('citehub-ref-blink');
	});
}

/**
 * Show a "Copied!" badge next to the reference row.
 * @param ref - The reference that was copied.
 */
function showCopiedBadge(ref: Reference): void {
	const name = ref.name || ref.id || '';
	const badge = document.createElement('span');
	badge.className = 'citehub-badge';
	badge.textContent = 'Copied!';
	const rows = document.querySelectorAll('.citehub-row');
	rows.forEach((row) => {
		if (row.textContent?.includes(name)) {
			const existing = row.querySelector('.citehub-badge');
			existing?.remove();
			row.appendChild(badge);
			setTimeout(() => badge.remove(), 900);
		}
	});
}

/**
 * Load saved panel dimensions from localStorage.
 * @returns Object with optional width and height values.
 */
function loadPanelSize(): { width?: number; height?: number } {
	try {
		const raw = localStorage.getItem(PANEL_SIZE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as { width?: number; height?: number };
		return parsed || {};
	} catch {
		return {};
	}
}

/**
 * Save panel dimensions to localStorage for persistence.
 * @param size - Object containing width and height to save.
 */
function savePanelSize(size: { width: number; height: number }): void {
	try {
		localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(size));
	} catch {
		/* ignore */
	}
}

/**
 * Close the inspector panel and clear highlights.
 * @param state - The inspector state to update.
 */
function performClose(state: InspectorState): void {
	state.open = false;
	clearHighlights();
}

/** Interface for the inspector root component's public methods. */
type InspectorRoot = { setRefs: (nextRefs: Reference[]) => void; setVisible: (flag: boolean) => void; getVisible: () => boolean };

/**
 * Type guard to check if a value is an InspectorRoot instance.
 * @param val - The value to check.
 * @returns True if val has the required InspectorRoot methods.
 */
function isInspectorRoot(val: unknown): val is InspectorRoot {
	return Boolean(
		val &&
		typeof (val as InspectorRoot).setRefs === 'function' &&
		typeof (val as InspectorRoot).setVisible === 'function' &&
		typeof (val as InspectorRoot).getVisible === 'function'
	);
}

/**
 * Open the Cite Hub inspector dialog with the given references.
 * If the dialog is already open, updates its reference list instead.
 * @param refs - Array of references to display in the inspector.
 * @param refreshFn - Optional callback to refresh the reference list.
 */
export async function openInspectorDialog(refs: Reference[], refreshFn?: () => Promise<void>): Promise<void> {
	if (!namespaceAllowed()) {
		mw.notify?.('Cite Hub is disabled in this namespace or content model.', { type: 'warn' });
		return;
	}

	injectPanelStyles();

	const existingApp = getMountedApp();
	const existingRoot = getMountedRoot();
	if (existingApp && isInspectorRoot(existingRoot)) {
		existingRoot.setRefs(refs);
		return;
	}

	const refreshCallback = refreshFn;
	const { Vue, Codex } = await loadCodexAndVue();
	createDialogMountIfNeeded();
	initCitationPopup();

	const appOptions = {
		data(): InspectorState {
			return {
				open: false,
				visible: true,
				refs,
				selectedRef: refs[0] ?? null,
				query: '',
				settings: getSettings(),
				showSettings: false,
				minHeight: 300,
				pendingChanges: [],
				editingRefId: null
			};
		},
		computed: {
			hasRefs(this: InspectorCtx): boolean {
				return Array.isArray(this.filteredRefs) && this.filteredRefs.length > 0;
			},
			hasPendingChanges(this: InspectorCtx): boolean {
				return this.pendingChanges.length > 0;
			},
			sortedRefs(this: InspectorCtx): Reference[] {
				const arr = Array.isArray(this.refs) ? this.refs.slice() : [];
				arr.sort((a, b) => {
					const ga = groupKey(a.name);
					const gb = groupKey(b.name);
					if (ga !== gb) return alphaIndex(ga) - alphaIndex(gb);
					return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true });
				});
				return arr;
			},
			filteredRefs(this: InspectorCtx): Reference[] {
				const q = (this.query || '').toLowerCase();
				if (!q) return this.sortedRefs;
				return this.sortedRefs.filter((ref) => {
					const name = ref.name?.toLowerCase() || '';
					const content = ref.contentWikitext?.toLowerCase() || '';
					return name.includes(q) || content.includes(q);
				});
			},
			firstByBucket(this: InspectorCtx): Record<string, string> {
				const map: Record<string, string> = {};
				this.filteredRefs.forEach((ref) => {
					const bucket = groupKey(ref.name);
					if (!map[bucket]) {
						map[bucket] = `citehub-anchor-${bucket}`;
					}
				});
				return map;
			}
		},
		methods: {
			refName(this: InspectorCtx, ref: Reference): string {
				return ref?.name ?? '(nameless)';
			},
			refUses(this: InspectorCtx, ref: Reference): number {
				return ref?.uses?.length ?? 0;
			},
			bucketFor(this: InspectorCtx, ref: Reference): string {
				return groupKey(ref?.name);
			},
			selectRef(this: InspectorCtx, ref: Reference): void {
				this.selectedRef = ref;
				highlightRef(ref);
			},
			setRefs(this: InspectorCtx, nextRefs: Reference[]): void {
				const prevId = this.selectedRef?.id;
				this.refs = nextRefs;
				const nextSelected = prevId ? nextRefs.find((r) => r.id === prevId) ?? nextRefs[0] : nextRefs[0];
				this.selectedRef = nextSelected ?? null;
				this.visible = true;
				if (this.selectedRef) {
					highlightRef(this.selectedRef);
				} else {
					clearHighlights();
				}
			},
			setVisible(this: InspectorCtx, show: boolean): void {
				this.visible = show;
				if (!show) {
					this.open = false;
					clearHighlights();
				}
			},
			getVisible(this: InspectorCtx): boolean {
				return this.visible;
			},
			onUpdateOpen(this: InspectorCtx, newValue: boolean): void {
				if (!newValue) {
					performClose(this);
				}
			},
			closeDialog(this: InspectorCtx): void {
				performClose(this);
			},
			scrollToBucket(this: InspectorCtx, bucket: string): void {
				const targetId = this.firstByBucket[bucket];
				if (!targetId) return;
				const el = document.getElementById(targetId);
				if (el) {
					el.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' });
				}
			},
			async refreshList(): Promise<void> {
				if (refreshCallback) {
					await refreshCallback();
				}
			},
			onQueryInput(this: InspectorCtx, evt: Event): void {
				const target = evt.target as HTMLInputElement | null;
				this.query = target?.value ?? '';
			},
			copyRefName(this: InspectorCtx, ref: Reference): void {
				const name = ref.name || '';
				if (!name) return;
				const formatted = formatCopy(name, this.settings.copyFormat);
				void navigator.clipboard?.writeText(formatted).catch(() => {
					/* ignore */
				});
				showCopiedBadge(ref);
			},
			copyRefContent(_this: InspectorCtx, ref: Reference): void {
				const content = ref.contentWikitext || '';
				void navigator.clipboard?.writeText(content).catch(() => {
					/* ignore */
				});
				showCopiedBadge(ref);
			},
			editRefName(this: InspectorCtx, ref: Reference): void {
				this.editingRefId = ref.id;
				// Focus the input after Vue updates the DOM
				setTimeout(() => {
					const input = document.querySelector<HTMLInputElement>('.citehub-row__name-input');
					if (input) {
						input.focus();
						input.select();
					}
				}, 0);
			},
			commitRefNameFromEvent(this: InspectorCtx & { commitRefName: (ref: Reference, newName: string) => void }, ref: Reference, event: Event): void {
				const target = event.target as HTMLInputElement | null;
				const value = target?.value ?? '';
				this.commitRefName(ref, value);
			},
			commitRefName(this: InspectorCtx, ref: Reference, newName: string): void {
				const oldName = this.pendingChanges.find((c) => c.refId === ref.id)?.oldName ?? ref.name ?? '';
				this.editingRefId = null;
				if (newName === oldName) {
					// Reverted to original - remove from queue if exists
					const idx = this.pendingChanges.findIndex((c) => c.refId === ref.id);
					if (idx >= 0) {
						this.pendingChanges.splice(idx, 1);
						ref.name = oldName;
					}
					return;
				}
				ref.name = newName;
				// Queue the change
				const existingIdx = this.pendingChanges.findIndex((c) => c.refId === ref.id);
				if (existingIdx >= 0) {
					this.pendingChanges[existingIdx].newName = newName;
				} else {
					this.pendingChanges.push({ refId: ref.id, oldName, newName });
				}
			},
			cancelEditRefName(this: InspectorCtx, ref: Reference): void {
				// Restore original name if there was a pending change
				const pending = this.pendingChanges.find((c) => c.refId === ref.id);
				if (pending) {
					ref.name = pending.oldName;
					const idx = this.pendingChanges.indexOf(pending);
					this.pendingChanges.splice(idx, 1);
				}
				this.editingRefId = null;
			},
			toggleSettings(this: InspectorCtx): void {
				this.showSettings = !this.showSettings;
			},
			saveChanges(this: InspectorCtx): void {
				// TODO: Implement actual wikitext editing
				mw.notify?.(`${this.pendingChanges.length} change(s) to save (not yet implemented)`, { type: 'info' });
			},
			saveSettings(this: InspectorCtx): void {
				saveSettings(this.settings);
				this.showSettings = false;
			},
			startResize(this: InspectorCtx, event: MouseEvent): void {
				const panelEl = document.querySelector<HTMLElement>('.citehub-panel');
				if (!panelEl) return;
				const startW = panelEl.offsetWidth;
				const startH = panelEl.offsetHeight;
				const startX = event.clientX;
				const startY = event.clientY;
				const onMove = (e: MouseEvent) => {
					const newW = Math.max(320, startW + (e.clientX - startX));
					const newH = Math.max(300, startH - (e.clientY - startY));
					panelEl.style.width = `${newW}px`;
					panelEl.style.height = `${newH}px`;
				};
				const onUp = (e: MouseEvent) => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
					document.body.style.cursor = '';
					const newW = Math.max(320, startW + (e.clientX - startX));
					const newH = Math.max(300, startH - (e.clientY - startY));
					savePanelSize({ width: newW, height: newH });
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
				document.body.style.cursor = 'nwse-resize';
			}
		},
		mounted(this: InspectorCtx) {
			if (this.selectedRef) {
				highlightRef(this.selectedRef);
			}
			const panelEl = document.querySelector<HTMLElement>('.citehub-panel');
			const sz = loadPanelSize();
			if (panelEl) {
				if (sz.width) panelEl.style.width = `${sz.width}px`;
				if (sz.height) panelEl.style.height = `${sz.height}px`;
			}
			applyMinHeight(this);
		},
		beforeUnmount() {
			clearHighlights();
		},
		template: PANEL_TEMPLATE
	};

	const app = Vue.createMwApp(appOptions);

	registerCodexComponents(app, Codex);
	mountApp(app);
}

/**
 * Get the ID used for the Cite Hub portlet link element.
 * @returns The portlet link element ID string.
 */
export function getPortletLinkId(): string {
	return PORTLET_LINK_ID;
}

/**
 * Set the visibility state of the Cite Hub panel.
 * Updates both the Vue component state and localStorage.
 * @param show - Whether the panel should be visible.
 */
export function setHubVisible(show: boolean): void {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		root.setVisible(show);
	}
	try {
		localStorage.setItem('citehub-visible', show ? '1' : '0');
	} catch {
		/* ignore */
	}
}

/**
 * Check if the Cite Hub panel is currently visible.
 * Checks the Vue component state first, then falls back to localStorage.
 * @returns True if the panel is visible.
 */
export function isHubVisible(): boolean {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		return root.getVisible();
	}
	try {
		return localStorage.getItem('citehub-visible') === '1';
	} catch {
		return false;
	}
}

/**
 * Get the alphabetical grouping key for a reference name.
 * Returns '#' for numeric, '*' for unnamed/special, or uppercase letter.
 * @param name - The reference name to categorize.
 * @returns Single character representing the group.
 */
function groupKey(name: string | null | undefined): string {
	if (!name) return '*';
	const first = name.trim().charAt(0);
	if (!first) return '*';
	if (/[0-9]/.test(first)) return '#';
	if (/[a-z]/i.test(first)) return first.toUpperCase();
	return '*';
}

/**
 * Get the sort index for an alphabetical group character.
 * Used to sort references by their group key.
 * @param char - The group character to get the index for.
 * @returns Numeric index for sorting (0-27, with 28 for unknown).
 */
function alphaIndex(char: string): number {
	const alphabet = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '*'];
	const idx = alphabet.indexOf(char);
	return idx === -1 ? alphabet.length : idx;
}

/**
 * Calculate and apply minimum height to the panel based on content.
 * Ensures the panel is tall enough to show the index and topbar.
 * @param state - The inspector state to update with minHeight.
 */
function applyMinHeight(state: InspectorCtx): void {
	const panelEl = document.querySelector<HTMLElement>('.citehub-panel');
	const indexCol = document.querySelector<HTMLElement>('.citehub-panel__index');
	const topbarEl = document.querySelector<HTMLElement>('.citehub-list-topbar');
	const headerEl = document.querySelector<HTMLElement>('.citehub-panel__header');
	if (!panelEl) return;
	const pad = 24; // body padding approx
	const headerH = headerEl?.offsetHeight || 0;
	const topbarH = topbarEl?.offsetHeight || 0;
	const indexH = indexCol?.scrollHeight || 0;
	const needed = headerH + pad + topbarH + indexH + 16;
	state.minHeight = Math.max(300, needed);
	const currentH = panelEl.offsetHeight;
	if (currentH < state.minHeight) {
		panelEl.style.height = `${state.minHeight}px`;
	}
}

/**
 * Format a reference name for copying based on user preference.
 * @param name - The reference name to format.
 * @param fmt - The format style: 'raw', 'r' (template), or 'ref' (tag).
 * @returns Formatted string ready for clipboard.
 */
function formatCopy(name: string, fmt: 'raw' | 'r' | 'ref'): string {
	if (fmt === 'r') return `{{r|${name}}}`;
	if (fmt === 'ref') return `<ref name="${escapeAttr(name)}" />`;
	return name;
}

/**
 * Escape double quotes in a string for use in HTML attributes.
 * @param value - The string to escape.
 * @returns String with double quotes replaced by &quot;.
 */
function escapeAttr(value: string): string {
	return value.replace(/"/g, '&quot;');
}
