import { Reference, InspectorState, InspectorCtx } from '../types';
import {
	createDialogMountIfNeeded,
	getMountedApp,
	getMountedRoot,
	loadCodexAndVue,
	mountApp,
	registerCodexComponents,
	ensureStyleElement
} from './codex';
import { getSettings, namespaceAllowed, saveSettings, settingsToTransformOptions } from './settings';
import { getWikitext } from '../data/wikitext_fetch';
import { openDiffPreview } from '../data/diff_preview';
import { initCitationPopup } from './citations';
import { formatCopy, groupKey, transformWikitext } from '../core/references';
import { prefetchTemplateDataForWikitext } from '../data/templatedata_fetch';
import { openMassRenameDialog } from './mass_rename';
import { disableChecks, enableChecks, isChecksActive } from './checks';
import panelStyles from './panel.css';
import PANEL_TEMPLATE from './panel.template.vue';

import { alphaIndex, escapeAttr } from '../core/string_utils';

const PANEL_STYLE_ELEMENT_ID = 'citeforge-panel-styles';
const HIGHLIGHT_CLASS = 'citeforge-ref-highlight';
const PORTLET_LINK_ID = 'citeforge-portlet-link';
const PANEL_SIZE_KEY = 'citeforge-panel-size';

const safeGroupKey = (name: string | null | undefined): string => groupKey(name);
const safeAlphaIndex = (char: string): number => alphaIndex(char);
const safeFormatCopy = (name: string, fmt: 'raw' | 'r' | 'ref'): string => formatCopy(name, fmt);

let panelStylesInjected = false;

/**
 * Inject panel styles into the document once.
 */
function injectPanelStyles(): void {
	if (panelStylesInjected) return;
	ensureStyleElement(PANEL_STYLE_ELEMENT_ID, panelStyles);
	panelStylesInjected = true;
}

/**
 * Highlight all DOM anchors associated with a reference.
 * Clears any existing highlights before applying new ones.
 * Optionally scrolls to the first anchor and triggers a blink animation.
 * @param ref - The reference to highlight, or null to clear all.
 * @param opts - Control blink/scroll behavior.
 */
function highlightRef(ref: Reference | null, opts: { blink?: boolean; scroll?: boolean } = {}): void {
	clearHighlights();
	if (!ref) return;
	const { blink = true, scroll = true } = opts;
	const anchors: Element[] = [];
	ref.uses.forEach((use) => {
		if (use.anchor) {
			use.anchor.classList.add(HIGHLIGHT_CLASS);
			if (blink) {
				use.anchor.classList.add('citeforge-ref-blink');
			}
			anchors.push(use.anchor);
		}
	});
	// Scroll to the first highlighted anchor
	if (scroll && anchors.length > 0) {
		anchors[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
}

/**
 * Remove all reference highlight styling from the document.
 */
export function clearHighlights(): void {
	document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
		node.classList.remove(HIGHLIGHT_CLASS);
		node.classList.remove('citeforge-ref-blink');
	});
}

/**
 * Show a "Copied!" badge next to the reference row.
 * @param ref - The reference that was copied.
 */
function showCopiedBadge(ref: Reference): void {
	const name = ref.name || ref.id || '';
	const badge = document.createElement('span');
	badge.className = 'citeforge-badge';
	badge.textContent = 'Copied!';
	const rows = document.querySelectorAll('.citeforge-row');
	rows.forEach((row) => {
		if (row.textContent?.includes(name)) {
			const existing = row.querySelector('.citeforge-badge');
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
 * Open the Cite Forge inspector dialog with the given references.
 * If the dialog is already open, updates its reference list instead.
 * @param refs - Array of references to display in the inspector.
 * @param refreshFn - Optional callback to refresh the reference list.
 */
export async function openInspectorDialog(refs: Reference[], refreshFn?: () => Promise<void>): Promise<void> {
	if (!namespaceAllowed()) {
		console.warn('[Cite Forge] Cite Forge is disabled in this namespace or content model.');
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
				editingRefId: null,
				checksOn: false
			};
		},
		computed: {
			hasRefs(this: InspectorCtx): boolean {
				return Array.isArray(this.filteredRefs) && this.filteredRefs.length > 0;
			},
			hasPendingChanges(this: InspectorCtx): boolean {
				return this.pendingChanges.length > 0;
			},
			nameConflicts(this: InspectorCtx): Set<string> {
				const counts = new Map<string, number>();
				this.refs.forEach((ref) => {
					if (!ref.name) return;
					const key = ref.name.trim();
					if (!key) return;
					counts.set(key, (counts.get(key) || 0) + 1);
				});
				const dupes = new Set<string>();
				counts.forEach((count, key) => {
					if (count > 1) dupes.add(key);
				});
				return dupes;
			},
			hasConflicts(this: InspectorCtx): boolean {
				return (this.nameConflicts?.size ?? 0) > 0;
			},
			copyFormatOptions(): Array<{ label: string; value: string }> {
				return [
					{ label: 'raw name', value: 'raw' },
					{ label: '{{r|name}}', value: 'r' },
					{ label: '<ref name="name" />', value: 'ref' }
				];
			},
				placementOptions(): Array<{ label: string; value: 'keep' | 'threshold' | 'all_ldr' | 'all_inline' }> {
					return [
						{ label: 'Keep as is', value: 'keep' },
						{ label: 'Refs with ≥ N uses to reflist', value: 'threshold' },
						{ label: 'All refs to reflist', value: 'all_ldr' },
						{ label: 'All refs inline', value: 'all_inline' }
					];
				},
			sortedRefs(this: InspectorCtx): Reference[] {
				const arr = Array.isArray(this.refs) ? this.refs.slice() : [];
				arr.sort((a, b) => {
					const ga = safeGroupKey(a.name);
					const gb = safeGroupKey(b.name);
					if (ga !== gb) return safeAlphaIndex(ga) - safeAlphaIndex(gb);
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
					const bucket = safeGroupKey(ref.name);
					if (!map[bucket]) {
						map[bucket] = `citeforge-anchor-${bucket}`;
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
				return safeGroupKey(ref?.name);
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
				if (this.checksOn) {
					enableChecks(this.refs);
					this.checksOn = isChecksActive();
				}
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
					disableChecks();
					this.checksOn = false;
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
			openMassRename(this: InspectorCtx & { applyMassRename: (renameMap: Record<string, string | null>, renameNameless: Record<string, string | null>) => void }): void {
				void openMassRenameDialog(this.refs, {
					onApply: (renameMap, renameNameless) => {
						this.applyMassRename(renameMap, renameNameless);
					}
				});
			},
			toggleChecks(this: InspectorCtx): void {
				console.info('[Cite Forge][Checks] Toggle requested', { current: this.checksOn, refs: this.refs.length });
				if (isChecksActive() || this.checksOn) {
					disableChecks();
					this.checksOn = false;
					console.info('[Cite Forge][Checks] Turned off');
					return;
				}
				enableChecks(this.refs);
				this.checksOn = isChecksActive();
				console.info('[Cite Forge][Checks] Turned on', { active: this.checksOn });
			},
			onQueryInput(this: InspectorCtx, evt: Event): void {
				const target = evt.target as HTMLInputElement | null;
				this.query = target?.value ?? '';
			},
			refHasConflict(this: InspectorCtx, ref: Reference): boolean {
				if (!ref.name) return false;
				const conflicts = this.nameConflicts;
				return conflicts instanceof Set ? conflicts.has(ref.name.trim()) : false;
			},
			copyRefName(this: InspectorCtx, ref?: Reference): void {
				const targetRef = ref ?? this.selectedRef;
				if (!targetRef) return;
				const name = targetRef.name || '';
				if (!name) return;
				const formatted = safeFormatCopy(name, this.settings.copyFormat);
				void navigator.clipboard?.writeText(formatted).catch(() => {
					/* ignore */
				});
				showCopiedBadge(targetRef);
			},
			copyRefContent(this: InspectorCtx, ref?: Reference): void {
				const targetRef = ref ?? this.selectedRef;
				if (!targetRef) {
					mw.notify?.('No reference selected to copy.', { type: 'warn', title: 'Cite Forge' });
					return;
				}
				const name = targetRef.name ? ` name="${escapeAttr(targetRef.name)}"` : '';
				const group = targetRef.group ? ` group="${escapeAttr(targetRef.group)}"` : '';
				const content = (targetRef.contentWikitext || '').trim();
				const raw = content
					? `<ref${name}${group}>${content}</ref>`
					: `<ref${name}${group} />`;
				void navigator.clipboard?.writeText(raw).catch(() => {
					/* ignore */
				});
				showCopiedBadge(targetRef);
			},
			editRefName(this: InspectorCtx, ref: Reference): void {
				this.editingRefId = ref.id;
				// Focus the input after Vue updates the DOM
				setTimeout(() => {
					const input = document.querySelector<HTMLInputElement>('.citeforge-row__name-input');
					if (input) {
						input.focus();
						input.select();
					}
				}, 0);
			},
			commitRefNameFromEvent(this: InspectorCtx & { commitRefName: (ref: Reference, newName: string) => void }, ref: Reference, event: Event): void {
				const target = event.target as HTMLInputElement | null;
				const value = (target?.value ?? '').trim();
				this.commitRefName(ref, value);
			},
			commitRefName(this: InspectorCtx, ref: Reference, newName: string): void {
				const nextName = newName.trim();
				const oldName = this.pendingChanges.find((c) => c.refId === ref.id)?.oldName ?? ref.name ?? '';
				this.editingRefId = null;
				if (nextName === oldName) {
					// Reverted to original - remove from queue if exists
					const idx = this.pendingChanges.findIndex((c) => c.refId === ref.id);
					if (idx >= 0) {
						this.pendingChanges.splice(idx, 1);
						ref.name = oldName;
					}
					return;
				}
				ref.name = nextName;
				// Queue the change
				const existingIdx = this.pendingChanges.findIndex((c) => c.refId === ref.id);
				if (existingIdx >= 0) {
					this.pendingChanges[existingIdx].newName = nextName;
				} else {
					this.pendingChanges.push({ refId: ref.id, oldName, newName: nextName });
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
			applyMassRename(this: InspectorCtx, renameMap: Record<string, string | null>, renameNameless: Record<string, string | null>): void {
				this.editingRefId = null;
				this.refs.forEach((ref) => {
					const currentName = ref.name || '';
					const proposed = currentName ? renameMap[currentName] : renameNameless[ref.id];
					if (proposed === undefined || proposed === null) return;
					const existing = this.pendingChanges.find((c) => c.refId === ref.id);
					const originalName = existing ? existing.oldName : currentName;
					if (proposed === originalName) {
						if (existing) {
							const idx = this.pendingChanges.indexOf(existing);
							if (idx >= 0) this.pendingChanges.splice(idx, 1);
						}
						ref.name = originalName;
						return;
					}
					ref.name = proposed;
					if (existing) {
						existing.newName = proposed;
					} else {
						this.pendingChanges.push({ refId: ref.id, oldName: originalName, newName: proposed });
					}
				});
				if (!this.pendingChanges.length) {
					mw.notify?.('No rename changes were added from mass rename.', { type: 'info', title: 'Cite Forge' });
				} else {
					mw.notify?.('Mass rename populated pending changes. Review and save to preview diffs.', {
						type: 'info',
						title: 'Cite Forge'
					});
				}
			},
			toggleSettings(this: InspectorCtx): void {
				this.showSettings = !this.showSettings;
			},
			async saveChanges(this: InspectorCtx): Promise<void> {
				if (this.hasConflicts) {
					mw.notify?.('Resolve duplicate reference names before saving.', { type: 'error', title: 'Cite Forge' });
					return;
				}
				if (!this.pendingChanges.length) {
					mw.notify?.('No pending Cite Forge changes to apply.', { type: 'info' });
					return;
				}
				try {
					const base = await getWikitext();
					const renameMap: Record<string, string | null> = {};
					const renameNameless: Record<string, string | null> = {};
					this.pendingChanges.forEach((c) => {
						if (c.newName && c.oldName !== c.newName) {
							if (c.oldName) {
								renameMap[c.oldName] = c.newName;
							} else {
								renameNameless[c.refId] = c.newName;
							}
						}
					});

					const transformOpts = settingsToTransformOptions(this.settings, renameMap, renameNameless);

					if (transformOpts.normalizeAll) {
						await prefetchTemplateDataForWikitext(base);
					}

					const result = transformWikitext(base, transformOpts);

					if (result.wikitext === base) {
						mw.notify?.('No changes were generated.', { type: 'info' });
						return;
					}

					openDiffPreview(result.wikitext, 'Cite Forge: reference adjustments');
					mw.notify?.('Opening diff view in a new tab...', { type: 'info' });
				} catch (err: unknown) {
					console.error('[Cite Forge] Failed to apply changes', err);
					mw.notify?.('Cite Forge could not prepare the diff. Please try again.', { type: 'error' });
				}
			},
			saveSettings(this: InspectorCtx): void {
				saveSettings(this.settings);
				this.showSettings = false;
			},
			startResize(this: InspectorCtx, event: MouseEvent): void {
				const panelEl = document.querySelector<HTMLElement>('.citeforge-panel');
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
				highlightRef(this.selectedRef, { blink: false, scroll: false });
			}
			const panelEl = document.querySelector<HTMLElement>('.citeforge-panel');
			const sz = loadPanelSize();
			if (panelEl) {
				if (sz.width) panelEl.style.width = `${sz.width}px`;
				if (sz.height) panelEl.style.height = `${sz.height}px`;
			}
			applyMinHeight(this);
		},
		beforeUnmount() {
			clearHighlights();
			disableChecks();
		},
		template: PANEL_TEMPLATE
	};

	const app = Vue.createMwApp(appOptions);

	registerCodexComponents(app, Codex);
	mountApp(app);
}

/**
 * Get the ID used for the Cite Forge portlet link element.
 * @returns The portlet link element ID string.
 */
export function getPortletLinkId(): string {
	return PORTLET_LINK_ID;
}

/**
 * Set the visibility state of the Cite Forge panel.
 * Updates both the Vue component state and localStorage.
 * @param show - Whether the panel should be visible.
 */
export function setHubVisible(show: boolean): void {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		root.setVisible(show);
	}
	try {
		localStorage.setItem('citeforge-visible', show ? '1' : '0');
	} catch {
		/* ignore */
	}
}

/**
 * Check if the Cite Forge panel is currently visible.
 * Checks the Vue component state first, then falls back to localStorage.
 * @returns True if the panel is visible.
 */
export function isHubVisible(): boolean {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		return root.getVisible();
	}
	try {
		return localStorage.getItem('citeforge-visible') === '1';
	} catch {
		return false;
	}
}

/**
 * Calculate and apply minimum height to the panel based on content.
 * Ensures the panel is tall enough to show the index and topbar.
 * @param state - The inspector state to update with minHeight.
 */
function applyMinHeight(state: InspectorCtx): void {
	const panelEl = document.querySelector<HTMLElement>('.citeforge-panel');
	const indexCol = document.querySelector<HTMLElement>('.citeforge-panel__index');
	const topbarEl = document.querySelector<HTMLElement>('.citeforge-list-topbar');
	const headerEl = document.querySelector<HTMLElement>('.citeforge-panel__header');
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
