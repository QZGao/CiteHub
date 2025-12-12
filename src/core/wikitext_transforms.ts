type LocationMode = 'all_inline' | 'all_ldr' | { minUsesForLdr: number };

export interface TransformOptions {
	renameMap?: Record<string, string>;
	dedupe?: boolean;
	locationMode?: LocationMode;
	sortRefs?: boolean;
	useTemplateR?: boolean;
	reflistTemplates?: string[];
	normalizeAll?: boolean;
}

export interface TransformResult {
	wikitext: string;
	changes: {
		renamed: Array<{ from: string; to: string }>;
		deduped: Array<{ from: string; to: string }>;
		movedToLdr: string[];
		movedToInline: string[];
	};
	warnings: string[];
}

type RefKey = string;

type RefUseKind = 'selfClosing' | 'full' | 'templateR';

interface RefUseInternal {
	name: string | null;
	group: string | null;
	start: number;
	end: number;
	kind: RefUseKind;
	content?: string;
	rTemplateId?: number;
}

interface RefRecord {
	name: string | null;
	group: string | null;
	key: RefKey;
	definitions: RefUseInternal[];
	uses: RefUseInternal[];
	ldrDefinitions: RefUseInternal[];
	canonical?: RefRecord;
	targetLocation: 'inline' | 'ldr';
}

interface TemplateMatch {
	start: number;
	end: number;
	name: string;
	content: string;
	params: TemplateParam[];
}

interface TemplateParam {
	name: string | null;
	value: string;
}

const DEFAULT_REFLIST_TEMPLATES = ['reflist', 'references'];

/**
 * Transform wikitext by applying rename, dedupe, and location rules without saving.
 * Produces updated wikitext and a change summary.
 */
export function transformWikitext(wikitext: string, options: TransformOptions = {}): TransformResult {
	const warnings: string[] = [];
	const renameMap = normalizeRenameMap(options.renameMap || {});
	const dedupe = Boolean(options.dedupe);
	const sortRefs = Boolean(options.sortRefs);
	const useTemplateR = Boolean(options.useTemplateR);
	const normalizeAll = options.normalizeAll !== false;
	const reflistNames = (options.reflistTemplates && options.reflistTemplates.length > 0
		? options.reflistTemplates
		: DEFAULT_REFLIST_TEMPLATES).map((n) => n.toLowerCase());

	const ctx = parseWikitext(wikitext, reflistNames);
	ctx.refs = normalizeRefKeys(ctx.refs);

	applyRenames(ctx.refs, renameMap);
	const deduped = dedupe ? applyDedupe(ctx.refs) : [];
	const targetMode = normalizeLocationMode(options.locationMode);
	assignLocations(ctx.refs, targetMode);

	const plan = buildReplacementPlan(ctx, {
		useTemplateR,
		sortRefs,
		normalizeAll
	});

	const replaced = applyReplacements(wikitext, plan.replacements);

	return {
		wikitext: replaced,
		changes: {
			renamed: Object.entries(renameMap).map(([from, to]) => ({ from, to })),
			deduped,
			movedToInline: plan.movedInline,
			movedToLdr: plan.movedLdr
		},
		warnings
	};
}

function normalizeLocationMode(mode?: LocationMode): LocationMode {
	if (!mode) return { minUsesForLdr: 2 };
	if (typeof mode === 'string') return mode;
	if (typeof mode.minUsesForLdr === 'number' && mode.minUsesForLdr >= 1) return mode;
	return { minUsesForLdr: 2 };
}

function normalizeRenameMap(rename: Record<string, string>): Record<string, string> {
	const map: Record<string, string> = {};
	Object.entries(rename).forEach(([k, v]) => {
		if (!k) return;
		if (v && v !== k) {
			map[k] = v;
		}
	});
	return map;
}

function applyRenames(refs: Map<RefKey, RefRecord>, rename: Record<string, string>): void {
	refs.forEach((ref) => {
		if (!ref.name) return;
		const next = rename[ref.name];
		if (next && next !== ref.name) {
			ref.name = next;
		}
	});
}

function applyDedupe(refs: Map<RefKey, RefRecord>): Array<{ from: string; to: string }> {
	const canonicalByContent = new Map<string, RefRecord>();
	const changes: Array<{ from: string; to: string }> = [];

	refIterator(refs).forEach((ref) => {
		const content = firstContent(ref);
		if (!content || !ref.name) return;
		const norm = normalizeContent(content);
		const existing = canonicalByContent.get(norm);
		if (existing && existing.name) {
			ref.canonical = existing;
			// Preserve content if canonical lacked it
			if (existing.definitions.length === 0 && ref.definitions.length > 0) {
				existing.definitions.push(...ref.definitions);
			}
			if (existing.ldrDefinitions.length === 0 && ref.ldrDefinitions.length > 0) {
				existing.ldrDefinitions.push(...ref.ldrDefinitions);
			}
			changes.push({ from: ref.name, to: existing.name });
		} else {
			canonicalByContent.set(norm, ref);
			ref.canonical = ref;
		}
	});

	return changes;
}

function assignLocations(refs: Map<RefKey, RefRecord>, mode: LocationMode): void {
	const processed = new Set<RefRecord>();
	refIterator(refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		if (processed.has(canonical)) return;
		if (!canonical.name) {
			canonical.targetLocation = 'inline';
			processed.add(canonical);
			return;
		}

		if (mode === 'all_inline') {
			canonical.targetLocation = 'inline';
			processed.add(canonical);
			return;
		}
		if (mode === 'all_ldr') {
			canonical.targetLocation = 'ldr';
			processed.add(canonical);
			return;
		}
		const usesCount = aggregateUses(refs, canonical).length;
		const threshold = mode.minUsesForLdr;
		canonical.targetLocation = usesCount >= threshold ? 'ldr' : 'inline';
		processed.add(canonical);
	});
}

function aggregateUses(refs: Map<RefKey, RefRecord>, canonical: RefRecord): RefUseInternal[] {
	const collected: RefUseInternal[] = [];
	refIterator(refs).forEach((ref) => {
		if ((ref.canonical ?? ref) === canonical) {
			collected.push(...ref.uses);
		}
	});
	collected.sort((a, b) => a.start - b.start);
	return collected;
}

function firstContent(ref: RefRecord): string | null {
	const def = ref.definitions.find((d) => (d.content || '').trim().length > 0) || ref.ldrDefinitions.find((d) => (d.content || '').trim().length > 0);
	return def?.content ?? null;
}

function normalizeContent(content: string): string {
	return content.replace(/\s+/g, ' ').trim();
}

function refKey(name: string | null, group: string | null): RefKey {
	return `${group ?? ''}::${name ?? ''}`;
}

function refIterator(refs: Map<RefKey, RefRecord>): RefRecord[] {
	return Array.from(refs.values());
}

function normalizeRefKeys(refs: Map<RefKey, RefRecord>): Map<RefKey, RefRecord> {
	const next = new Map<RefKey, RefRecord>();
	refIterator(refs).forEach((ref) => {
		const key = refKey(ref.name, ref.group);
		ref.key = key;
		const existing = next.get(key);
		if (existing) {
			existing.definitions.push(...ref.definitions);
			existing.ldrDefinitions.push(...ref.ldrDefinitions);
			existing.uses.push(...ref.uses);
			ref.canonical = existing;
		} else {
			next.set(key, ref);
		}
	});
	return next;
}

/**
 * Parse wikitext for refs, uses, and reflist templates.
 */
function parseWikitext(
	wikitext: string,
	reflistNames: string[]
): { refs: Map<RefKey, RefRecord>; templates: TemplateMatch[]; rTemplates: Array<{ id: number; start: number; end: number; names: string[] }> } {
	const refs = new Map<RefKey, RefRecord>();
	const templates = findTemplates(wikitext, reflistNames);
	const rTemplates: Array<{ id: number; start: number; end: number; names: string[] }> = [];

	const getRef = (name: string | null, group: string | null): RefRecord => {
		const key = refKey(name, group);
		const existing = refs.get(key);
		if (existing) return existing;
		const rec: RefRecord = { name, group, key, definitions: [], uses: [], ldrDefinitions: [], targetLocation: 'inline' };
		refs.set(key, rec);
		return rec;
	};

	const refFull = /<ref\b([^>/]*?)>([\s\S]*?)<\/ref>/gi;
	for (const match of wikitext.matchAll(refFull)) {
		const idx = match.index ?? 0;
		if (inTemplateRange(idx, templates)) continue;
		const attrs = match[1] ?? '';
		const content = match[2] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		const ref = getRef(name, group);
		const use: RefUseInternal = {
			name,
			group,
			start: idx,
			end: idx + match[0].length,
			kind: 'full',
			content
		};
		ref.definitions.push(use);
		ref.uses.push(use);
	}

	const refSelf = /<ref\b([^>]*?)\/\s*>/gi;
	for (const match of wikitext.matchAll(refSelf)) {
		const idx = match.index ?? 0;
		if (inTemplateRange(idx, templates)) continue;
		const attrs = match[1] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		const ref = getRef(name, group);
		const use: RefUseInternal = {
			name,
			group,
			start: idx,
			end: idx + match[0].length,
			kind: 'selfClosing'
		};
		ref.uses.push(use);
	}

	const rTemplate = /\{\{\s*r\s*(\|[\s\S]*?)\}\}/gi;
	for (const match of wikitext.matchAll(rTemplate)) {
		const idx = match.index ?? 0;
		if (inTemplateRange(idx, templates)) continue;
		const params = match[1] ?? '';
		const names = parseRTemplateNames(params);
		const tplId = rTemplates.length;
		rTemplates.push({ id: tplId, start: idx, end: idx + match[0].length, names });
		names.forEach((name) => {
			const ref = getRef(name, null);
			const use: RefUseInternal = {
				name,
				group: null,
				start: idx,
				end: idx + match[0].length,
				kind: 'templateR',
				rTemplateId: tplId
			};
			ref.uses.push(use);
		});
	}

	templates.forEach((tpl) => {
		const refsParam = tpl.params.find((p) => p.name && p.name.toLowerCase() === 'refs');
		if (refsParam && refsParam.value) {
			const inner = refsParam.value;
			let innerMatch: RegExpExecArray | null;
			const innerFull = /<ref\b([^>/]*?)>([\s\S]*?)<\/ref>/gi;
			while ((innerMatch = innerFull.exec(inner)) !== null) {
				const attrs = innerMatch[1] ?? '';
				const content = innerMatch[2] ?? '';
				const name = extractAttr(attrs, 'name');
				const group = extractAttr(attrs, 'group');
				const ref = getRef(name, group);
				const posStart = tpl.start + refsParam.value.indexOf(innerMatch[0]);
				const use: RefUseInternal = {
					name,
					group,
					start: posStart,
					end: posStart + innerMatch[0].length,
					kind: 'full',
					content
				};
				ref.ldrDefinitions.push(use);
			}
		}
	});

	return { refs, templates, rTemplates };
}

function inTemplateRange(idx: number, templates: TemplateMatch[]): boolean {
	return templates.some((tpl) => idx >= tpl.start && idx <= tpl.end);
}

function extractAttr(attrs: string, name: string): string | null {
	const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
	const match = attrs.match(re);
	if (!match) return null;
	return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Plan replacements for refs and reflist templates.
 */
function buildReplacementPlan(
	ctx: { refs: Map<RefKey, RefRecord>; templates: TemplateMatch[]; rTemplates: Array<{ id: number; start: number; end: number; names: string[] }> },
	opts: { useTemplateR: boolean; sortRefs: boolean; normalizeAll: boolean }
): { replacements: Replacement[]; movedInline: string[]; movedLdr: string[] } {
	const replacements: Replacement[] = [];
	const movedInline: string[] = [];
	const movedLdr: string[] = [];

	const canonicalMap = new Map<RefRecord, RefRecord>();
	refIterator(ctx.refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		canonicalMap.set(ref, canonical);
	});

	// Replace chained {{r}} templates preserving names
	ctx.rTemplates.forEach((tpl) => {
		const rendered = renderRTemplate(tpl, ctx.refs, opts.useTemplateR);
		if (rendered !== null) {
			replacements.push({ start: tpl.start, end: tpl.end, text: rendered });
		}
	});

	// Build replacements for individual refs
	refIterator(ctx.refs).forEach((ref) => {
		const canonical = canonicalMap.get(ref) ?? ref;
		const targetName = canonical.name ?? ref.name;
		const targetLocation = canonical.targetLocation;
		const content = firstContent(canonical);

		// Uses (including ones tied to definitions)
		ref.uses.forEach((use, useIdx) => {
			if (use.kind === 'templateR' && typeof use.rTemplateId === 'number') {
				// Already handled via rTemplates replacement
				return;
			}
			const isDefinition = ref.definitions.includes(use);
			const canonicalContent = content || '';
			const normalizedContent = opts.normalizeAll ? normalizeContentBlock(canonicalContent) : canonicalContent;
			if (targetLocation === 'inline' && canonical === ref && useIdx === 0 && canonicalContent) {
				// Ensure first use holds definition
				const rendered = renderRefTag(targetName, ref.group, normalizedContent);
				replacements.push({ start: use.start, end: use.end, text: rendered });
				if (targetName) movedInline.push(targetName);
			} else {
				const rendered = renderRefSelf(targetName, ref.group, opts.useTemplateR);
				replacements.push({ start: use.start, end: use.end, text: rendered });
			}
			if (isDefinition && targetLocation === 'ldr' && targetName) {
				movedLdr.push(targetName);
			}
		});
	});

	// Rebuild reflist templates
	const ldrEntries = buildLdrEntries(ctx.refs);
	ctx.templates.forEach((tpl) => {
		const updated = updateReflistTemplate(tpl, ldrEntries, opts.sortRefs);
		if (updated !== tpl.content) {
			replacements.push({ start: tpl.start, end: tpl.end, text: updated });
		}
	});

	// If no reflist but we have LDR entries, append one
	if (ldrEntries.length > 0 && ctx.templates.length === 0) {
		const appendText = buildStandaloneReflist(ldrEntries, opts.sortRefs);
		replacements.push({ start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER, text: appendText });
	}

	// De-duplicate overlapping replacements by keeping last
	const collapsed = collapseReplacements(replacements);

	return { replacements: collapsed, movedInline, movedLdr };
}

function buildLdrEntries(refs: Map<RefKey, RefRecord>): Array<{ name: string; group: string | null; content: string }> {
	const list: Array<{ name: string; group: string | null; content: string }> = [];
	refIterator(refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		if (canonical !== ref) return;
		if (canonical.targetLocation !== 'ldr') return;
		if (!canonical.name) return;
		const content = firstContent(canonical);
		if (!content) return;
		list.push({ name: canonical.name, group: canonical.group, content });
	});
	return list;
}

function renderRefSelf(name: string | null, group: string | null, preferTemplateR: boolean): string {
	if (!name) {
		// Fall back to empty self-closing tag
		return '<ref />';
	}
	if (preferTemplateR && !group) {
		return `{{r|${name}}}`;
	}
	const attrs = [`name="${escapeAttr(name)}"`];
	if (group) attrs.push(`group="${escapeAttr(group)}"`);
	return `<ref ${attrs.join(' ')} />`;
}

function renderRefTag(name: string | null, group: string | null, content: string): string {
	const attrs: string[] = [];
	if (name) attrs.push(`name="${escapeAttr(name)}"`);
	if (group) attrs.push(`group="${escapeAttr(group)}"`);
	const inner = normalizeContentBlock(content);
	return `<ref${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</ref>`;
}

function escapeAttr(value: string): string {
	return value.replace(/"/g, '&quot;');
}

function renderRTemplate(tpl: { names: string[] }, refs: Map<RefKey, RefRecord>, preferTemplateR: boolean): string | null {
	const targetNames: string[] = [];
	tpl.names.forEach((name) => {
		const ref = refs.get(refKey(name, null));
		const canonical = ref?.canonical ?? ref;
		const target = canonical?.name ?? name;
		if (target) {
			targetNames.push(target);
		}
	});
	if (!targetNames.length) return null;

	// If templateR is preferred, emit a single chained template; otherwise emit self-closing refs.
	if (preferTemplateR) {
		return `{{r|${targetNames.join('|')}}}`;
	}
	return targetNames.map((n) => renderRefSelf(n, null, false)).join(' ');
}

function normalizeContentBlock(content: string): string {
	let text = String(content ?? '');
	text = text.replace(/[ \t]+\n/g, '\n'); // trim trailing spaces on lines
	text = text.replace(/\n{3,}/g, '\n\n'); // collapse excessive blank lines
	return text.trim();
}

function updateReflistTemplate(tpl: TemplateMatch, ldrEntries: Array<{ name: string; group: string | null; content: string }>, sort: boolean): string {
	const params = tpl.params.slice();
	const hasRefsParam = params.some((p) => p.name && p.name.toLowerCase() === 'refs');
	const refsValue = renderRefsValue(ldrEntries, sort);

	if (ldrEntries.length === 0) {
		// Remove refs param if present
		const filtered = params.filter((p) => !(p.name && p.name.toLowerCase() === 'refs'));
		return renderTemplate(tpl.name, filtered);
	}

	if (hasRefsParam) {
		const next = params.map((p) => (p.name && p.name.toLowerCase() === 'refs' ? { ...p, value: refsValue } : p));
		return renderTemplate(tpl.name, next);
	}

	params.push({ name: 'refs', value: refsValue });
	return renderTemplate(tpl.name, params);
}

function renderRefsValue(entries: Array<{ name: string; group: string | null; content: string }>, sort: boolean): string {
	const sorted = sort ? entries.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })) : entries;
	return '\n' + sorted.map((e) => renderRefTag(e.name, e.group, e.content)).join('\n') + '\n';
}

function renderTemplate(name: string, params: TemplateParam[]): string {
	const parts = params.map((p) => {
		if (p.name) return `${p.name}=${p.value}`;
		return p.value;
	});
	return `{{${name}${parts.length ? '|' + parts.join('|') : ''}}}`;
}

function buildStandaloneReflist(entries: Array<{ name: string; group: string | null; content: string }>, sort: boolean): string {
	const refsValue = renderRefsValue(entries, sort);
	return `\n{{reflist|refs=${refsValue}}}`;
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

function collapseReplacements(repls: Replacement[]): Replacement[] {
	// Remove duplicates and sort
	const filtered = repls.slice().sort((a, b) => b.start - a.start);
	const seen = new Set<string>();
	const result: Replacement[] = [];
	for (const r of filtered) {
		const key = `${r.start}-${r.end}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(r);
	}
	return result;
}

function applyReplacements(source: string, replacements: Replacement[]): string {
	let output = source;
	let offset = 0;
	const sorted = replacements.slice().sort((a, b) => a.start - b.start);
	sorted.forEach((r) => {
		const start = r.start + offset;
		const end = r.end + offset;
		output = output.slice(0, start) + r.text + output.slice(end);
		offset += r.text.length - (r.end - r.start);
	});
	return output;
}

/**
 * Find template instances with simple brace depth parsing.
 */
function findTemplates(source: string, names: string[]): TemplateMatch[] {
	const matches: TemplateMatch[] = [];
	const lowerNames = names.map((n) => n.toLowerCase());
	let i = 0;
	while (i < source.length) {
		const idx = source.indexOf('{{', i);
		if (idx === -1) break;

		let j = idx + 2;
		while (j < source.length && /\s/.test(source[j])) j++;
		let nameEnd = j;
		while (nameEnd < source.length && /[A-Za-z0-9_:-]/.test(source[nameEnd])) nameEnd++;
		const name = source.slice(j, nameEnd);
		if (!lowerNames.includes(name.toLowerCase())) {
			i = idx + 2;
			continue;
		}

		let depth = 1;
		let k = nameEnd;
		while (k < source.length && depth > 0) {
			if (source[k] === '{' && source[k + 1] === '{') {
				depth++;
				k += 2;
				continue;
			}
			if (source[k] === '}' && source[k + 1] === '}') {
				depth--;
				k += 2;
				continue;
			}
			k++;
		}
		if (depth !== 0) {
			i = nameEnd;
			continue;
		}

		const end = k;
		const content = source.slice(idx, end);
		const paramText = source.slice(nameEnd, end - 2); // strip closing braces
		const params = parseTemplateParams(paramText);
		matches.push({ start: idx, end, name, content, params });
		i = end;
	}
	return matches;
}

function parseTemplateParams(paramText: string): TemplateParam[] {
	const trimmed = paramText.replace(/^\s*\|?/, '');
	if (!trimmed) return [];
	const parts = splitParams(trimmed);
	return parts.map((p) => {
		const eqIdx = p.indexOf('=');
		if (eqIdx === -1) return { name: null, value: p };
		const name = p.slice(0, eqIdx).trim();
		const value = p.slice(eqIdx + 1);
		return { name, value };
	});
}

function splitParams(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (ch === '{' && next === '{') {
			depth++;
			current += ch;
			continue;
		}
		if (ch === '}' && next === '}') {
			if (depth > 0) depth--;
			current += ch;
			continue;
		}
		if (ch === '|' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current) parts.push(current);
	return parts.map((p) => p.trim());
}

function parseRTemplateNames(paramString: string): string[] {
	const trimmed = paramString.replace(/^\|/, '');
	if (!trimmed) return [];
	const parts = splitParams(trimmed);
	const names: string[] = [];
	parts.forEach((part) => {
		const val = part.trim();
		if (!val) return;
		const match = val.match(/^(?:name\s*=\s*)?(.*)$/i);
		const name = match?.[1]?.trim();
		if (name) names.push(name);
	});
	return names;
}
