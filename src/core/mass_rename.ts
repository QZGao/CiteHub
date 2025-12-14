import { Reference } from '../types';
import { pickTemplateParams, parseTemplateParams } from './references';
import {
	convertDigitsToAscii,
	domainFromUrl,
	domainShortFromUrl,
	extractUrl,
	firstYearCandidate,
	normalizeNameKey,
	stripMarkup,
	toLatin
} from './string_utils';

export type NamingField =
	| 'last'
	| 'first'
	| 'author'
	| 'title'
	| 'work'
	| 'publisher'
	| 'domain'
	| 'domainShort'
	| 'phrase'
	| 'year'
	| 'fulldate';

export type IncrementStyle = 'latin' | 'numeric';

export interface RefMetadata {
	last?: string;
	first?: string;
	author?: string;
	title?: string;
	work?: string;
	publisher?: string;
	domain?: string;
	domainShort?: string;
	phrase?: string;
	year?: string;
	yearAscii?: string;
	textYear?: string;
	textYearAscii?: string;
	dateYMD?: string;
	dateDisplay?: string;
}

export interface MassRenameConfig {
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

export const NAMING_FIELDS: readonly NamingField[] = [
	'last',
	'first',
	'author',
	'title',
	'work',
	'publisher',
	'domain',
	'domainShort',
	'phrase',
	'year',
	'fulldate'
];

export const DEFAULT_FIELDS: NamingField[] = ['domainShort', 'fulldate'];

export const DEFAULT_CONFIG: MassRenameConfig = {
	fields: DEFAULT_FIELDS,
	lowercase: true,
	stripDiacritics: false,
	stripPunctuation: false,
	replaceSpaceWith: '_',
	convertYearDigits: true,
	delimiter: '-',
	delimiterConditional: false,
	incrementStyle: 'latin'
};

export function createDefaultConfig(): MassRenameConfig {
	return { ...DEFAULT_CONFIG, fields: [...DEFAULT_FIELDS] };
}

export function normalizeFieldSelection(
	selection: NamingField[],
	allowed: readonly NamingField[] = NAMING_FIELDS
): NamingField[] {
	const allowedSet = new Set(allowed);
	const seen = new Set<NamingField>();
	const result: NamingField[] = [];
	selection.forEach((field) => {
		if (!allowedSet.has(field) || seen.has(field)) return;
		seen.add(field);
		result.push(field);
	});
	return result;
}

function stripLanguagePrefix(value: string): string {
	return (value || '').replace(/^[a-zA-Z-]{2,}:\s*/, '');
}

export function extractMetadata(ref: Reference, providedContent?: string): RefMetadata {
	const content = providedContent ?? ref.contentWikitext ?? '';
	const params = parseTemplateParams(content);
	const meta: RefMetadata = {};

	const templateName = (() => {
		const match = content.match(/\{\{\s*([^{|}]+?)(?:\s*\||\s*}})/);
		if (!match) return null;
		return match[1].replace(/_/g, ' ').trim().toLowerCase();
	})();

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
		const shortDomain = domainShortFromUrl(url);
		meta.domainShort = typeof shortDomain === 'string' ? shortDomain : undefined;
	}

	const rawDate = pick('date');
	const normalizedDate = rawDate ? convertDigitsToAscii(stripMarkup(rawDate)) : '';
	if (normalizedDate) {
		const pad = (n: number) => n.toString().padStart(2, '0');
		const parsed = Date.parse(normalizedDate);
		if (!Number.isNaN(parsed)) {
			const d = new Date(parsed);
			meta.dateYMD = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
			if (typeof d.toLocaleDateString === 'function') {
				meta.dateDisplay = d.toLocaleDateString(undefined, { timeZone: 'UTC' });
			} else {
				meta.dateDisplay = normalizedDate;
			}
		} else {
			const match = normalizedDate.match(/(\d{4})(?:\D?(\d{1,2})(?:\D?(\d{1,2}))?)?/);
			if (match) {
				const [, y, m, d] = match;
				if (y && m && d) {
					meta.dateYMD = `${y}${pad(Number(m))}${pad(Number(d))}`;
					meta.dateDisplay = `${y}-${pad(Number(m))}-${pad(Number(d))}`;
				} else if (y && m) {
					meta.dateYMD = `${y}${pad(Number(m))}`;
					meta.dateDisplay = `${y}-${pad(Number(m))}`;
				} else if (y) {
					meta.dateYMD = y;
					meta.dateDisplay = y;
				}
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

	const applyTemplateOverrides = (): void => {
		switch (templateName) {
			case 'cite tweet': {
				const user = pick('user');
				const userClean = user ? stripMarkup(user) : '';
				if (userClean) {
					if (!meta.author) meta.author = userClean;
					if (!meta.last) meta.last = userClean;
				}
				if (!meta.work) meta.work = 'Twitter';
				if (!meta.publisher) meta.publisher = 'Twitter';
				if (!meta.domain) meta.domain = 'twitter.com';
				if (!meta.domainShort) meta.domainShort = 'twitter';
				break;
			}
			case 'cite arxiv': {
				if (!meta.work) meta.work = 'arXiv';
				if (!meta.publisher) meta.publisher = 'arXiv';
				if (!meta.domain) meta.domain = 'arxiv.com';
				if (!meta.domainShort) meta.domainShort = 'arxiv';
				break;
			}
			default:
				break;
		}
	};

	applyTemplateOverrides();

	return meta;
}

export function normalizeKey(name: string): string {
	return normalizeNameKey(name);
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
		case 'domainShort':
			return meta.domainShort || null;
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

export function buildSuggestion(
	meta: RefMetadata,
	ref: Reference,
	config: MassRenameConfig,
	reserved: Set<string>
): string {
	const fields = normalizeFieldSelection(config.fields && config.fields.length ? config.fields : DEFAULT_FIELDS);
	const rawParts: string[] = [];

	fields.forEach((key) => {
		if (key === 'year') {
			const year = pickYear(meta, config);
			if (year) rawParts.push(year);
			return;
		}
		if (key === 'fulldate') {
			if (meta.dateYMD) rawParts.push(meta.dateYMD);
			return;
		}
		const candidate = pickField(meta, key);
		if (candidate) rawParts.push(candidate);
	});

	if (rawParts.length === 0) {
		const fallbackOrder: NamingField[] = ['title', 'domainShort', 'domain', 'phrase', 'author', 'work', 'year', 'fulldate'];
		for (const key of fallbackOrder) {
			if (key === 'year') {
				const year = pickYear(meta, config);
				if (year) {
					rawParts.push(year);
					break;
				}
				continue;
			}
			if (key === 'fulldate') {
				if (meta.dateYMD) {
					rawParts.push(meta.dateYMD);
					break;
				}
				continue;
			}
			const candidate = pickField(meta, key);
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
		combined = sanitizeToken(ref.name || meta.domain || meta.phrase || ref.id || 'ref', config);
	}
	combined = combined || 'ref';
	combined = ensureUniqueName(combined, reserved, config);
	return combined;
}
