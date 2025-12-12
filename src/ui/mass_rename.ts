import { Reference } from '../types';
import { ensureMount, ensureStyleElement, loadCodexAndVue, registerCodexComponents } from './codex';
import {
	groupKey,
	isAutoName,
	pickTemplateParams,
	parseTemplateParams,
	getRefContentMap
} from '../core/references';
import styles from './mass_rename.css';
import MASS_RENAME_TEMPLATE from './mass_rename.template.vue';
import {
	alphaIndex,
	convertDigitsToAscii,
	domainFromUrl,
	extractUrl,
	firstYearCandidate,
	normalizeNameKey,
	stripMarkup,
	toLatin
} from '../core/string_utils';
import { getWikitext } from '../data/wikitext_fetch';

type VueModule = { createMwApp: (options: unknown) => VueApp };
type VueApp = { mount: (selector: string) => unknown; component?: (name: string, value: unknown) => VueApp };

const STYLE_ID = 'citeforge-mass-rename-styles';
const MOUNT_ID = 'citeforge-mass-rename-mount';
type ApplyCallback = (renameMap: Record<string, string | null>, renameNameless: Record<string, string | null>) => void;
type MassRenameOptions = { onApply?: ApplyCallback };
let onApplyMassRename: ApplyCallback | null = null;

type NamingField = 'last' | 'first' | 'author' | 'title' | 'work' | 'publisher' | 'domain' | 'phrase' | 'year' | 'fulldate';
type IncrementStyle = 'latin' | 'numeric';

interface RefMetadata {
	last?: string;
	first?: string;
	author?: string;
	title?: string;
	work?: string;
	publisher?: string;
	domain?: string;
	phrase?: string;
	year?: string;
	yearAscii?: string;
	textYear?: string;
	textYearAscii?: string;
	dateYMD?: string;
	dateDisplay?: string;
}

interface MassRenameConfig {
	fields: NamingField[];
	lowercase: boolean;
	stripDiacritics: boolean;
	stripPunctuation: boolean;
	replaceSpaceWith: string;
	convertYearDigits: boolean;
	delimiter: string;
	delimiterConditional: boolean;
	incrementStyle: IncrementStyle;
}

interface RenameRow {
	ref: Reference;
	metadata: RefMetadata;
	active: boolean;
	autoName: boolean;
	suggestion: string;
	locked: boolean;
	error: string | null;
	snippet: string;
}

type ContentStats = {
	fromRef: number;
	mapByName: number;
	mapById: number;
	missing: Array<{ id: string; name: string | null }>;
};

interface MassRenameState {
	open: boolean;
	query: string;
	showInactive: boolean;
	rows: RenameRow[];
	config: MassRenameConfig;
	conflictKeys: string[];
	applyBusy: boolean;
	fieldMenuItems: Array<{ value: NamingField; label: string; description?: string }>;
	fieldMenuConfig: { visibleItemLimit: number };
	fieldInput: string;
	fieldChips: Array<{ label: string; value: NamingField }>;
	fieldSelection: NamingField[];
}

type MassRenameCtx = MassRenameState & {
	sortedRows: RenameRow[];
	filteredRows: RenameRow[];
	activeCount: number;
	hasConflicts: boolean;
	conflictCount: number;
	applyDisabled: boolean;
	incrementOptions: Array<{ label: string; value: IncrementStyle }>;
};

type MassRenameRoot = {
	setRefs: (next: Reference[], contentMap?: Map<string, string>) => void;
	openDialog: () => void;
};

const DEFAULT_FIELDS: NamingField[] = ['work', 'fulldate'];

const FIELD_OPTIONS: Array<{ value: NamingField; label: string; description?: string }> = [
	{ value: 'last', label: 'Author last name', description: 'Uses last/surname or author field' },
	{ value: 'first', label: 'Author first name', description: 'Uses first/given name' },
	{ value: 'author', label: 'Author (full)', description: 'Full author string' },
	{ value: 'title', label: 'Title', description: 'Title/chapter/contribution' },
	{ value: 'work', label: 'Work/publication', description: 'Journal, newspaper, website, periodical' },
	{ value: 'publisher', label: 'Publisher/institution', description: 'Publisher or institution field' },
	{ value: 'domain', label: 'Website domain', description: 'Domain derived from URL' },
	{ value: 'phrase', label: 'First phrase', description: 'First few words of the reference text' },
	{ value: 'year', label: 'Year', description: 'Year from date/year fields' },
	{ value: 'fulldate', label: 'Full date (yyyymmdd)', description: 'Full date in yyyymmdd format when available' }
];

const FIELD_MENU_CONFIG = { visibleItemLimit: 8 };

function normalizeFieldSelection(selection: NamingField[]): NamingField[] {
	const allowed = new Set(FIELD_OPTIONS.map((o) => o.value));
	const seen = new Set<NamingField>();
	const result: NamingField[] = [];
	selection.forEach((field) => {
		if (!allowed.has(field) || seen.has(field)) return;
		seen.add(field);
		result.push(field);
	});
	return result;
}

function chipForField(field: NamingField): { label: string; value: NamingField } {
	const option = FIELD_OPTIONS.find((o) => o.value === field);
	return { label: option?.label || field, value: field };
}

function chipsFromSelection(selection: NamingField[]): Array<{ label: string; value: NamingField }> {
	return normalizeFieldSelection(selection).map(chipForField);
}

const DEFAULT_CONFIG: MassRenameConfig = {
	fields: DEFAULT_FIELDS,
	lowercase: false,
	stripDiacritics: false,
	stripPunctuation: false,
	replaceSpaceWith: '_',
	convertYearDigits: true,
	delimiter: '-',
	delimiterConditional: false,
	incrementStyle: 'latin'
};

function createDefaultConfig(): MassRenameConfig {
	return { ...DEFAULT_CONFIG, fields: [...DEFAULT_FIELDS] };
}

let mountedApp: VueApp | null = null;
let mountedRoot: unknown = null;

function isMassRenameRoot(val: unknown): val is MassRenameRoot {
	return Boolean(val && typeof (val as MassRenameRoot).setRefs === 'function' && typeof (val as MassRenameRoot).openDialog === 'function');
}

function stripLanguagePrefix(value: string): string {
	return (value || '').replace(/^[a-zA-Z-]{2,}:\s*/, '');
}

function extractMetadata(ref: Reference): RefMetadata {
	const content = ref.contentWikitext || '';
	const params = parseTemplateParams(content);
	const meta: RefMetadata = {};

	const pick = (...keys: string[]): string | undefined => pickTemplateParams(params, ...keys);
	meta.last = pick('last', 'last1', 'surname', 'author1');
	meta.first = pick('first', 'first1', 'given');
	meta.author = pick('author', 'authors');
	const titleRaw = pick('title', 'script-title', 'chapter', 'contribution');
	meta.title = stripMarkup(stripLanguagePrefix(titleRaw || ''));
	meta.work = stripMarkup(pick('work', 'journal', 'newspaper', 'website', 'periodical') || '');
	meta.publisher = stripMarkup(pick('publisher', 'institution') || '');

	const url = pick('url', 'archive-url') || extractUrl(content);
	if (url) {
		meta.domain = domainFromUrl(url) || undefined;
	}

	const rawDate = pick('date');
	const normalizedDate = rawDate ? convertDigitsToAscii(stripMarkup(rawDate)) : '';
	if (normalizedDate) {
		const parsed = Date.parse(normalizedDate);
		if (!Number.isNaN(parsed)) {
			const d = new Date(parsed);
			const pad = (n: number) => n.toString().padStart(2, '0');
			meta.dateYMD = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
			if (typeof d.toLocaleDateString === 'function') {
				meta.dateDisplay = d.toLocaleDateString(undefined, { timeZone: 'UTC' });
			} else {
				meta.dateDisplay = normalizedDate;
			}
		}
	}

	const baseYear = firstYearCandidate(pick('year', 'date') || rawDate || '');
	if (baseYear) {
		meta.year = baseYear.original;
		if (baseYear.ascii !== baseYear.original) meta.yearAscii = baseYear.ascii;
	}
	if (!meta.year) {
		const fallback = firstYearCandidate(content);
		if (fallback) {
			meta.textYear = fallback.original;
			if (fallback.ascii !== fallback.original) meta.textYearAscii = fallback.ascii;
		}
	}

	const authorGuess = meta.author ? stripMarkup(meta.author) : '';
	if (!meta.last && authorGuess) {
		const parts = authorGuess.split(/[,;]| and /i);
		meta.last = parts[0]?.trim();
	}

	const phraseSource = stripMarkup(content);
	if (phraseSource) {
		meta.phrase = phraseSource.split(/\s+/).slice(0, 6).join(' ');
	}

	return meta;
}

function sanitizeToken(token: string, config: MassRenameConfig): string {
	if (!token) return '';
	let text = stripMarkup(token);
	if (config.stripDiacritics) {
		text = text.normalize('NFD').replace(/\p{Mn}/gu, '');
	}
	if (config.stripPunctuation) {
		text = text.replace(/[\p{P}\p{S}]+/gu, ' ');
	}
	text = text.replace(/[<>{}\[\]|"]/g, ' ');
	text = text.trim();
	if (config.lowercase) {
		text = text.toLowerCase();
	}
	const spaceReplacement = config.replaceSpaceWith;
	if (typeof spaceReplacement === 'string') {
		text = text.replace(/\s+/g, spaceReplacement);
	}
	text = text.replace(/_{2,}/g, '_').replace(/\s{2,}/g, ' ');
	return text.trim();
}

function normalizeKey(name: string): string {
	return normalizeNameKey(name);
}

function pickField(meta: RefMetadata, field: NamingField): string | null {
	switch (field) {
		case 'last':
			return meta.last || null;
		case 'first':
			return meta.first || null;
		case 'author':
			return meta.author || meta.last || null;
		case 'title':
			return meta.title || null;
		case 'work':
			return meta.work || null;
		case 'publisher':
			return meta.publisher || null;
		case 'domain':
			return meta.domain || null;
		case 'phrase':
			return meta.phrase || null;
		case 'year':
			return meta.year || meta.textYear || null;
		case 'fulldate':
			return meta.dateYMD || null;
		default:
			return null;
	}
}

function pickYear(meta: RefMetadata, config: MassRenameConfig): string | null {
	const direct = config.convertYearDigits ? meta.yearAscii || meta.year : meta.year;
	if (direct) return direct;
	return null;
}

function ensureUniqueName(base: string, reserved: Set<string>, config: MassRenameConfig): string {
	const cleanBase = base || 'ref';
	let name = cleanBase;
	let normalized = normalizeKey(name);
	if (normalized && !reserved.has(normalized)) {
		reserved.add(normalized);
		return name;
	}
	const delimiter = config.delimiterConditional && !/\d$/.test(cleanBase) ? '' : config.delimiter;
	let counter = config.incrementStyle === 'numeric' ? 2 : 0;
	do {
		const suffix = config.incrementStyle === 'numeric' ? String(counter) : toLatin(counter);
		name = `${cleanBase}${delimiter}${suffix}`;
		normalized = normalizeKey(name);
		counter++;
	} while (normalized && reserved.has(normalized));
	if (normalized) reserved.add(normalized);
	return name;
}

function joinParts(parts: string[], config: MassRenameConfig): string {
	let acc = '';
	for (const part of parts) {
		if (!part) continue;
		if (!acc) {
			acc = part;
			continue;
		}
		const useDelimiter = config.delimiterConditional ? /\d$/.test(acc) : true;
		acc += (useDelimiter ? config.delimiter : '') + part;
	}
	return acc;
}

function buildSuggestion(row: RenameRow, config: MassRenameConfig, reserved: Set<string>): string {
	const fields = normalizeFieldSelection(config.fields && config.fields.length ? config.fields : DEFAULT_FIELDS);
	const rawParts: string[] = [];

	fields.forEach((key) => {
		if (key === 'year') {
			const year = pickYear(row.metadata, config);
			if (year) rawParts.push(year);
			return;
		}
		if (key === 'fulldate') {
			if (row.metadata.dateYMD) rawParts.push(row.metadata.dateYMD);
			return;
		}
		const candidate = pickField(row.metadata, key);
		if (candidate) rawParts.push(candidate);
	});

	if (rawParts.length === 0) {
		const fallbackOrder: NamingField[] = ['title', 'domain', 'phrase', 'author', 'work', 'year', 'fulldate'];
		for (const key of fallbackOrder) {
			if (key === 'year') {
				const year = pickYear(row.metadata, config);
				if (year) {
					rawParts.push(year);
					break;
				}
				continue;
			}
			if (key === 'fulldate') {
				if (row.metadata.dateYMD) {
					rawParts.push(row.metadata.dateYMD);
					break;
				}
				continue;
			}
			const candidate = pickField(row.metadata, key);
			if (candidate) {
				rawParts.push(candidate);
				break;
			}
		}
	}

	const sanitizedParts = rawParts
		.map((p) => sanitizeToken(p, config))
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	let combined = joinParts(sanitizedParts, config);
	if (!combined) {
		combined = sanitizeToken(row.ref.name || row.metadata.domain || row.metadata.phrase || row.ref.id || 'ref', config);
	}
	combined = combined || 'ref';
	combined = ensureUniqueName(combined, reserved, config);
	return combined;
}

function validateRows(rows: RenameRow[]): string[] {
	const usage = new Map<string, number>();
	const bump = (key: string | null) => {
		if (!key) return;
		usage.set(key, (usage.get(key) || 0) + 1);
	};

	rows.forEach((row) => {
		if (!row.active) {
			if (row.ref.name) bump(normalizeKey(row.ref.name));
			return;
		}
		bump(normalizeKey(row.suggestion));
	});

	const conflicts = new Set<string>();
	usage.forEach((count, key) => {
		if (count > 1) conflicts.add(key);
	});

	rows.forEach((row) => {
		row.error = null;
		if (!row.active) return;
		const trimmed = (row.suggestion || '').trim();
		if (!trimmed) {
			row.error = 'Enter a name for this reference.';
			return;
		}
		if (/^\d+$/.test(trimmed)) {
			row.error = 'Names cannot be numbers only.';
			return;
		}
		if (/[<>{}\[\]|"]/.test(trimmed)) {
			row.error = 'Contains invalid characters.';
			return;
		}
		if (conflicts.has(normalizeKey(trimmed))) {
			row.error = 'Conflicts with another reference name.';
		}
	});

	return Array.from(conflicts);
}

function regenerate(rows: RenameRow[], config: MassRenameConfig, respectLocked: boolean): string[] {
	const reserved = new Set<string>();
	rows.forEach((row) => {
		if (!row.active) {
			if (row.ref.name) {
				const norm = normalizeKey(row.ref.name);
				if (norm) reserved.add(norm);
			}
			return;
		}
		if (respectLocked && row.locked) {
			const norm = normalizeKey(row.suggestion);
			if (norm) reserved.add(norm);
		}
	});

	rows.forEach((row) => {
		if (!row.active) return;
		const suggestion = buildSuggestion(row, config, reserved);
		row.suggestion = suggestion;
		row.locked = false;
		const norm = normalizeKey(row.suggestion);
		if (norm) reserved.add(norm);
	});

	return validateRows(rows);
}

function resolveContent(ref: Reference, contentMap?: Map<string, string>, stats?: ContentStats): string {
	const fromRef = ref.contentWikitext || '';
	if (fromRef.trim()) {
		if (stats) stats.fromRef += 1;
		return fromRef;
	}
	if (ref.name && contentMap?.has(ref.name)) {
		const hit = contentMap.get(ref.name) || '';
		if (stats) stats.mapByName += 1;
		console.info('[Cite Forge][mass-rename] Using map content by name', { name: ref.name, length: hit.length });
		return hit;
	}
	if (contentMap?.has(ref.id)) {
		const hit = contentMap.get(ref.id) || '';
		if (stats) stats.mapById += 1;
		console.info('[Cite Forge][mass-rename] Using map content by id', { id: ref.id, length: hit.length });
		return hit;
	}
	if (stats) stats.missing.push({ id: ref.id, name: ref.name ?? null });
	return '';
}

function prepareRows(refs: Reference[], contentMap?: Map<string, string>): RenameRow[] {
	const stats: ContentStats = { fromRef: 0, mapByName: 0, mapById: 0, missing: [] };
	const rows = refs.map((ref) => {
		const content = resolveContent(ref, contentMap, stats);
		const snippet = (content || '').replace(/\s+/g, ' ').trim();
		const metadata = extractMetadata({ ...ref, contentWikitext: content });
		if (!content.trim()) {
			console.info('[Cite Forge][mass-rename] Missing content for ref', {
				refId: ref.id,
				name: ref.name,
				hasMapMatch: Boolean((ref.name && contentMap?.has(ref.name)) || contentMap?.has(ref.id)),
				mapSize: contentMap?.size ?? 0
			});
		}
		const auto = isAutoName(ref.name);
		return {
			ref,
			metadata,
			active: !ref.name || auto,
			autoName: auto,
			suggestion: ref.name || '',
			locked: false,
			error: null,
			snippet
		};
	});
	console.info('[Cite Forge][mass-rename] Content resolution stats', {
		totalRefs: refs.length,
		fromRef: stats.fromRef,
		mapByName: stats.mapByName,
		mapById: stats.mapById,
		missing: stats.missing.slice(0, 5)
	});
	return rows;
}

function matchesQuery(row: RenameRow, q: string): boolean {
	if (!q) return true;
	const needle = q.toLowerCase();
	const haystack = [
		row.ref.name || '',
		row.suggestion || '',
		row.metadata.title || '',
		row.metadata.author || '',
		row.metadata.domain || '',
		row.snippet || ''
	]
		.join(' ')
		.toLowerCase();
	return haystack.includes(needle);
}

async function buildContentMap(refs: Reference[]): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	try {
		const wikitext = await getWikitext();
		const parsedMap = getRefContentMap(wikitext);
		parsedMap.forEach((content, key) => {
			map.set(key, content);
		});
		refs.forEach((ref) => {
			const content = (ref.contentWikitext || '').trim();
			if (!content) return;
			if (ref.name && !map.has(ref.name)) map.set(ref.name, content);
			if (!map.has(ref.id)) map.set(ref.id, content);
		});
	} catch {
		refs.forEach((ref) => {
			const content = (ref.contentWikitext || '').trim();
			if (!content) return;
			if (ref.name && !map.has(ref.name)) map.set(ref.name, content);
			if (!map.has(ref.id)) map.set(ref.id, content);
		});
	}
	console.info('[Cite Forge][mass-rename] Built ref content map', {
		totalEntries: map.size,
		withName: Array.from(map.keys()).filter((k) => !k.startsWith('__nameless_')).length,
		sample: Array.from(map.entries()).slice(0, 5).map(([k, v]) => ({ key: k, len: v.length }))
	});
	return map;
}

export async function openMassRenameDialog(refs: Reference[], options?: MassRenameOptions): Promise<void> {
	ensureStyleElement(STYLE_ID, styles);
	ensureMount(MOUNT_ID);
	onApplyMassRename = options?.onApply || null;

	const contentMap = await buildContentMap(refs);
	console.info('[Cite Forge][mass-rename] Opening dialog with refs', {
		refCount: refs.length,
		contentKeys: contentMap.size
	});

	if (mountedApp && isMassRenameRoot(mountedRoot)) {
		mountedRoot.setRefs(refs, contentMap);
		mountedRoot.openDialog();
		return;
	}

	const { Vue, Codex } = await loadCodexAndVue();
	const baseRows = prepareRows(refs, contentMap);

	const appOptions = {
		data(): MassRenameState {
			return {
				open: true,
				query: '',
				showInactive: false,
				rows: baseRows,
				config: createDefaultConfig(),
				conflictKeys: [],
				applyBusy: false,
				fieldMenuItems: FIELD_OPTIONS,
				fieldMenuConfig: FIELD_MENU_CONFIG,
				fieldInput: '',
				fieldSelection: [...DEFAULT_FIELDS],
				fieldChips: chipsFromSelection(DEFAULT_FIELDS)
			};
		},
		computed: {
			incrementOptions(): Array<{ label: string; value: IncrementStyle }> {
				return [
					{ label: 'Latin letters (a, b, c)', value: 'latin' },
					{ label: 'Numbers (2, 3, 4)', value: 'numeric' }
				];
			},
			sortedRows(this: MassRenameCtx): RenameRow[] {
				return this.rows.slice().sort((a, b) => {
					const ga = groupKey(a.ref.name);
					const gb = groupKey(b.ref.name);
					if (ga !== gb) return alphaIndex(ga) - alphaIndex(gb);
					return (a.ref.name || '').localeCompare(b.ref.name || '', undefined, { sensitivity: 'base', numeric: true });
				});
			},
			filteredRows(this: MassRenameCtx): RenameRow[] {
				return this.sortedRows.filter((row) => matchesQuery(row, this.query) && (this.showInactive || row.active));
			},
			activeCount(this: MassRenameCtx): number {
				return this.rows.filter((r) => r.active).length;
			},
			hasConflicts(this: MassRenameCtx): boolean {
				return this.conflictKeys.length > 0;
			},
			conflictCount(this: MassRenameCtx): number {
				return this.conflictKeys.length;
			},
			applyDisabled(this: MassRenameCtx): boolean {
				const hasError = this.rows.some((row) => row.active && (row.error || !(row.suggestion || '').trim()));
				return this.applyBusy || hasError || this.activeCount === 0;
			}
		},
		watch: {
			config: {
				handler(this: MassRenameCtx) {
					this.conflictKeys = regenerate(this.rows, this.config, true);
				},
				deep: true
			}
		},
		methods: {
			openDialog(this: MassRenameCtx): void {
				this.open = true;
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},
			closeDialog(this: MassRenameCtx): void {
				this.open = false;
			},
			setRefs(this: MassRenameCtx, next: Reference[], contentMap?: Map<string, string>): void {
				this.rows = prepareRows(next, contentMap);
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},
			onQueryInput(this: MassRenameCtx, evt: Event): void {
				const target = evt.target as HTMLInputElement | null;
				this.query = target?.value ?? '';
			},
			bucketFor(this: MassRenameCtx, row: RenameRow): string {
				return groupKey(row.ref.name);
			},
			onFieldInput(this: MassRenameCtx, value: string): void {
				this.fieldInput = value;
				const lower = value.toLowerCase();
				this.fieldMenuItems = lower
					? FIELD_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(lower))
					: FIELD_OPTIONS;
			},
			onFieldSelection(this: MassRenameCtx, value: NamingField[]): void {
				const normalized = normalizeFieldSelection(value || []);
				this.fieldSelection = normalized;
				this.fieldChips = chipsFromSelection(normalized);
				this.config.fields = normalized;
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},
			regenerateSuggestions(this: MassRenameCtx, respectLocked = true): void {
				this.conflictKeys = regenerate(this.rows, this.config, respectLocked);
			},
			resetAll(this: MassRenameCtx): void {
				this.config = createDefaultConfig();
				this.fieldSelection = [...DEFAULT_FIELDS];
				this.fieldChips = chipsFromSelection(DEFAULT_FIELDS);
				this.fieldMenuItems = FIELD_OPTIONS;
				this.fieldInput = '';
				this.rows.forEach((row) => {
					row.locked = false;
				});
				this.conflictKeys = regenerate(this.rows, this.config, false);
			},
			onToggleRow(this: MassRenameCtx, row: RenameRow): void {
				row.locked = false;
				if (row.active) {
					this.conflictKeys = regenerate(this.rows, this.config, true);
				} else {
					row.error = null;
					this.conflictKeys = validateRows(this.rows);
				}
			},
			onSuggestionEdited(this: MassRenameCtx, row: RenameRow, value: string): void {
				row.suggestion = value;
				row.locked = true;
				this.conflictKeys = validateRows(this.rows);
			},
			regenerateRow(this: MassRenameCtx, row: RenameRow): void {
				row.locked = false;
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},
			applyRenames(this: MassRenameCtx): void {
				if (this.applyDisabled) return;
				const renameMap: Record<string, string | null> = {};
				const renameNameless: Record<string, string | null> = {};
				this.rows.forEach((row) => {
					if (!row.active) return;
					const newName = (row.suggestion || '').trim();
					if (!newName) return;
					if (row.ref.name) {
						if (row.ref.name !== newName) {
							renameMap[row.ref.name] = newName;
						}
					} else {
						renameNameless[row.ref.id] = newName;
					}
				});

				if (!Object.keys(renameMap).length && !Object.keys(renameNameless).length) {
					mw.notify?.('No rename changes to apply.', { type: 'info', title: 'Cite Forge' });
					return;
				}

				try {
					this.applyBusy = true;
					if (onApplyMassRename) {
						onApplyMassRename(renameMap, renameNameless);
						mw.notify?.('Applied to inspector. Review and save there to preview diffs.', {
							type: 'info',
							title: 'Cite Forge'
						});
						this.open = false;
					} else {
						mw.notify?.('No inspector available to receive mass rename changes.', {
							type: 'warn',
							title: 'Cite Forge'
						});
					}
				} catch (err: unknown) {
					console.error('[Cite Forge] Mass rename failed', err);
					mw.notify?.('Mass rename could not apply changes. Please try again.', {
						type: 'error',
						title: 'Cite Forge'
					});
				} finally {
					this.applyBusy = false;
				}
			}
		},
		created(this: MassRenameCtx) {
			this.conflictKeys = regenerate(this.rows, this.config, false);
		},
		template: MASS_RENAME_TEMPLATE
	};

	const app = (Vue as VueModule).createMwApp(appOptions);
	registerCodexComponents(app, Codex);
	mountedApp = app;
	mountedRoot = app.mount(`#${MOUNT_ID}`);
}
