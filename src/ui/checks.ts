import { containsCJK } from '../core/string_utils';
import type { Reference } from '../types';

type MarkerRecord = { marker: HTMLElement; host: Element };

let active = false;
let markers: MarkerRecord[] = [];

const processedHarvParents = new WeakSet<HTMLElement>();
const annotationsByParent = new Map<HTMLElement, { errors: Set<string>; warnings: Set<string> }>();

function getAnnotationBucket(parent: HTMLElement): { errors: Set<string>; warnings: Set<string> } {
	let bucket = annotationsByParent.get(parent);
	if (!bucket) {
		bucket = { errors: new Set<string>(), warnings: new Set<string>() };
		annotationsByParent.set(parent, bucket);
	}
	return bucket;
}

function appendAnnotation(parent: HTMLElement, message: string, type: 'error' | 'warning' = 'error'): void {
	const bucket = getAnnotationBucket(parent);
	const store = type === 'warning' ? bucket.warnings : bucket.errors;
	const key = message.trim();
	if (store.has(key)) return;
	store.add(key);
}

function formatMessages(messages: Set<string>): string {
	const list = Array.from(messages);
	return list
		.map((msg, idx) => {
			let text = msg.trim();
			const isLast = idx === list.length - 1;
			const endsWithSemicolon = text.endsWith(';');
			const endsWithPeriod = text.endsWith('.');
			const endsWithQuestion = text.endsWith('?');
			const endsWithExclamation = text.endsWith('!');

			if (isLast) {
				if (endsWithSemicolon) text = text.slice(0, -1).trim();
				if (!(endsWithPeriod || endsWithQuestion || endsWithExclamation)) {
					text += '.';
				}
			} else {
				if (!(endsWithSemicolon || endsWithPeriod || endsWithQuestion || endsWithExclamation)) {
					text += ';';
				} else if (endsWithPeriod) {
					text = `${text.slice(0, -1).trim()};`;
				} else if (endsWithQuestion || endsWithExclamation) {
					text += ';';
				}
			}

			return text;
		})
		.join(' ');
}

function flushAnnotations(): void {
	annotationsByParent.forEach((bucket, parent) => {
		const errorText = formatMessages(bucket.errors);
		if (errorText) {
			const err = document.createElement('span');
			err.className = 'citeforge-check-errors';
			err.textContent = ` ${errorText}`;
			parent.appendChild(err);
		}

		const warningText = formatMessages(bucket.warnings);
		if (warningText) {
			const warn = document.createElement('span');
			warn.className = 'citeforge-check-warning';
			warn.textContent = ` ${warningText}`;
			parent.appendChild(warn);
		}
	});
	annotationsByParent.clear();
}

function annotateHarvText(anchor: HTMLAnchorElement, parent: HTMLElement): void {
	if (processedHarvParents.has(parent)) return;
	processedHarvParents.add(parent);

	const href = anchor.getAttribute('href') || '';
	const text = parent.textContent || '';
	const segments = text.split(';');

	segments.forEach((rawSegment) => {
		const commaCount = (rawSegment.match(/,/g) || []).length;
		const segment = rawSegment.replace('Harv error: link to', '            ');

		if (segment.includes('pp.')) {
			const pos = segment.indexOf('pp.');
			const snippet = segment.substring(pos, pos + 12);

			if (snippet.includes('-')) {
				appendAnnotation(parent, 'Hyphen in pg. range;');
			}

			const shouldFlagPpError =
				href.startsWith('#CITEREF') &&
				segment.indexOf('–') < 0 &&
				segment.indexOf('&') < 0 &&
				commaCount < 2 &&
				segment.indexOf('-') < 0 &&
				segment.toLowerCase().indexOf(' and ') < 0 &&
				segment.indexOf('&ndash;') < 0;

			if (shouldFlagPpError) {
				appendAnnotation(parent, `P/PP error? ${snippet};`);
			}
		} else if (href.startsWith('#CITEREF') && segment.includes(' p.')) {
			const pos = segment.indexOf(' p.');
			const snippet = segment.substring(pos, pos + 12);
			const commaCount2 = (snippet.match(/,/g) || []).length;

			const hasRangeIndicators =
				snippet.indexOf('–') > 0 || commaCount2 > 0 || snippet.indexOf('-') > 0 || snippet.indexOf('&ndash;') > 0;
			const isCommonException =
				snippet.indexOf(', not') >= 0 || snippet.indexOf(', n.') >= 0 || snippet.indexOf(', cit') >= 0;

			if (hasRangeIndicators && !isCommonException) {
				appendAnnotation(parent, `P/PP error? ${snippet};`);
			}

			if (snippet.indexOf('-') > 0) {
				appendAnnotation(parent, 'Hyphen in pg. range;');
			}
		}
	});
}

function annotateHarvErrors(anchor: HTMLAnchorElement, id: string): boolean {
	const parent = anchor.parentElement;
	if (!parent) return false;
	const target = document.getElementById(id);

	if (!target) {
		appendAnnotation(parent, `Link to ${id} has no target.`);
	}

	annotateHarvText(anchor, parent);
	return Boolean(target);
}

function annotateReferenceMetadata(): void {
	const spans = document.querySelectorAll<HTMLElement>('.Z3988');
	const idMarkers = ['arxiv', 'asin', 'bibcode', 'doi:', 'isbn', 'issn', 'jfm', 'jstor', 'lccn', ' mr ', 'oclc', ' ol ', 'osti', 'pmc', 'pmid', 'rfc', 'ssrn', 'zbl'];
	let withLocs = false;
	let withoutLocs = false;
	let contraryLocs = false;
	let withLocsCnt = 0;
	let withoutLocsCnt = 0;

	spans.forEach((span) => {
		const parent = span.parentElement;
		if (!parent) return;

		const srctxt = parent.textContent || '';
		const srctxtLower = srctxt.toLowerCase();
		const rawTitle = span.getAttribute('title') || '';
		let title = rawTitle;
		try {
			title = decodeURIComponent(rawTitle);
		} catch {
			title = rawTitle;
		}
		const authorSegments = title.split('rft.au=');
		const parentName = parent.nodeName;

		if (parentName === 'I' || parentName === 'B') {
			appendAnnotation(parent, 'Unexpected result – extra formatting in template?', 'warning');
		}

		if (title.includes('rft.atitle=') && title.includes('rft.btitle=')) {
			if (!srctxt.includes(' pp.') && !srctxt.includes(' p.')) {
				appendAnnotation(parent, 'Missing pagenums for book chapter?', 'warning');
			}
		}

		for (let i = 0; i < authorSegments.length; i++) {
			if (title.includes('rft.au=') && !srctxt.includes('et al.')) {
				if (!authorSegments[i].includes('+')) {
					const nameParts = authorSegments[i].split('&');
					if (containsCJK(nameParts[0])) continue; // Skip CJK names
					appendAnnotation(parent, `Missing first name for: ${nameParts[0]};`);
				}
			}
		}

		const hasId =
			idMarkers.some((marker) => srctxtLower.includes(marker)) || /rft_id=(?:https?:|urn:|info:doi|info:hdl)/i.test(title);

		const isArticle = title.includes('rft.genre=article');
		const hasJournalTitle = /rft\.jtitle=|rft\.stitle=/.test(title);
		if (isArticle && hasJournalTitle && !hasId) {
			appendAnnotation(parent, 'Missing identifier (ISSN, JSTOR, etc.);');
		}

		const isBookItem = title.includes('rft.genre=bookitem');
		if (title.includes('rft.genre=book')) {
			const hasPlace = title.indexOf('rft.place') >= 0;
			const hasBookTitle = title.includes('rft.btitle=');

			if (
				!srctxt.includes('Oxford University Press') &&
				!srctxt.includes('University of Calcutta') &&
				!srctxt.includes('Princeton University Press') &&
				!srctxt.includes('Cambridge University Press')
			) {
				if (!hasPlace) {
					withoutLocs = true;
					withoutLocsCnt += 1;
					if (withLocs) contraryLocs = true;
					if (contraryLocs) {
						appendAnnotation(
							parent,
							`Inconsistent use of Publisher Location (${withLocsCnt} with; ${withoutLocsCnt} without);`
						);
					}
				} else {
					withLocs = true;
					withLocsCnt += 1;
					if (withoutLocs) {
						contraryLocs = true;
						appendAnnotation(
							parent,
							`Inconsistent use of Publisher Location (${withLocsCnt} with; ${withoutLocsCnt} without);`
						);
					}
				}
			}

			const hasPublisher = title.indexOf('rft.pub') >= 0 || (isBookItem && hasBookTitle);
			if (!hasPublisher) {
				appendAnnotation(parent, 'Missing Publisher;');
			}

			if (title.indexOf('rft.date') > 0) {
				const dateIdx = title.indexOf('rft.date') + 9;
				const myDate = title.slice(dateIdx, dateIdx + 4);
				const numericDate = Number.parseInt(myDate, 10);

				if (numericDate >= 1970) {
					if (!hasId) {
						appendAnnotation(parent, 'Missing ISBN;');
					}
				} else {
					if (title.indexOf('rft.isbn') > 0 && srctxt.indexOf(') [') < 0) {
						appendAnnotation(parent, 'Pub. too early for ISBN, perhaps needs {{para|orig-year}};');
					}
					if (!hasId) {
						appendAnnotation(parent, 'Missing Identifier/control number, e.g. OCLC;');
					}
				}
			} else {
				appendAnnotation(parent, 'Missing Year/Date;');
			}
		}

		const isWebGenre = title.includes('http') && !title.includes('rft.genre=book');
		if (isWebGenre) {
			const hasArchive = /archiv|原始內容|原始内容|オリジナル|원본 문서/i.test(srctxtLower);
			if (!hasArchive) {
				appendAnnotation(parent, 'Missing archive link;');
				const hasAccessDate = /retrieved|存檔於|存档于|よりアーカイブ|에서 보존된 문서/i.test(srctxtLower) || title.indexOf('rft.date') >= 0;
				if (!hasAccessDate) {
					appendAnnotation(parent, 'Missing access date;');
				}
			}
		}
	});
}

const REF_SECTION_IDS = new Set([
	'#Books',
	'#Journals',
	'#Articles',
	'#Biographies',
	'#Bibliography',
	'#References',
	'#Citations_and_notes',
	'#Literature_cited',
	'#Works_cited',
	'#Book_sources',
	'#Primary_sources',
	'#Secondary_sources',
	'#Sources',
	'#Specialized_studies'
]);

function collectRefSectionAnchors(): string[] {
	const tocNodes = document.querySelectorAll<HTMLElement>('.toctext');
	const anchors: string[] = [];
	tocNodes.forEach((node) => {
		const text = node.innerText || '';
		const anchor = `#${text.replace(' ', '_')}`;
		anchors.push(anchor);
	});
	anchors.reverse();
	return anchors.filter((id) => REF_SECTION_IDS.has(id));
}

function annotateReferenceSorting(): void {
	const refHeaders = collectRefSectionAnchors();
	const alreadySorted = new WeakSet<HTMLElement>();

	refHeaders.forEach((headerId) => {
		const anchor = document.querySelector<HTMLElement>(headerId);
		const refSection = anchor?.parentElement?.nextElementSibling;
		if (!anchor || !refSection) return;

		const citations = Array.from(refSection.querySelectorAll<HTMLElement>('.citation'));
		const sortedCites: string[] = [];
		const unsortedCites: string[] = [];
		const sortIndices: number[] = [];
		let oldAuth = '';

		citations.forEach((cite, idx) => {
			if (alreadySorted.has(cite)) return;

			const id = cite.getAttribute('id') || '';
			if (id && !id.startsWith('CITEREF')) return;

			const grandparentId = cite.parentElement?.parentElement?.id || '';
			if (grandparentId.includes('cite_note')) return;

			if (!id || !id.startsWith('CITEREF')) {
				appendAnnotation(cite, 'Missing ref= anchor?;', 'warning');
			}

			let sortText = '';
			if (!id) {
				sortText = (cite.innerText || '').replace(/"/g, '');
				if (!sortText.trim()) return;
				sortText = sortText.trim();

				if (sortText.startsWith('A ')) {
					sortText = sortText.slice(2);
					sortText = sortText.charAt(0).toUpperCase() + sortText.slice(1);
				}
				if (sortText.startsWith('An ')) {
					sortText = sortText.slice(3);
					sortText = sortText.charAt(0).toUpperCase() + sortText.slice(1);
				}
				if (sortText.startsWith('The ')) {
					sortText = sortText.slice(4);
					sortText = sortText.charAt(0).toUpperCase() + sortText.slice(1);
				}

				if (sortText[0] === '—') {
					sortText = oldAuth + sortText;
				}

				sortText = sortText.replace(/"/g, '');
				if (sortText.indexOf(')') > 0) {
					sortText = sortText.substring(0, sortText.indexOf(')')) + ')';
					const yearMatch = /\d{4}/.exec(sortText);
					if (yearMatch) {
						sortText = sortText.replace(yearMatch[0], '');
						sortText = sortText.replace('(', `(${yearMatch[0]}-`);
					}
					sortText = sortText.replace(' )', ')');
				}
				if ((sortText.match(/\s/g) || []).length > 5) {
					const pos = sortText.split(' ', 5).join(' ').length;
					sortText = sortText.substring(0, pos);
				}
			} else {
				sortText = id.replace('CITEREF', '');
				const firstAuth = (cite.innerText || '').split(',')[0].replace(/"/g, '');
				if (sortText.indexOf(firstAuth) > 0) {
					sortText = `${firstAuth}_${sortText.replace(firstAuth, '')}`;
				}
			}

			oldAuth = sortText.replace(/[{()}]/g, '').replace(/—/g, '').replace(/\)/g, '').trim();
			sortText = sortText.toLowerCase().replace(/'/g, '');

			sortedCites.push(sortText);
			if (unsortedCites.includes(sortText)) {
				appendAnnotation(cite, `Duplicate author/date: ${sortText};`, 'warning');
			}
			unsortedCites.push(sortText);
			sortIndices.push(idx);
			alreadySorted.add(cite);
		});

		const collator = new Intl.Collator();
		const sortedCopy = [...sortedCites].sort((a, b) => collator.compare(a, b));
		for (let i = 0; i < unsortedCites.length; i++) {
			if (unsortedCites[i] !== sortedCopy[i]) {
				const pos = sortIndices[i];
				const expected = sortedCopy[i];
				const target = citations[pos];
				if (target) {
					appendAnnotation(target, `Sort error, expected: ${expected};`, 'warning');
				}
			}
		}
	});
}

function detectStyles(target: HTMLElement | null): { style: 'CS1' | 'CS2'; csblue: boolean; cite: HTMLElement } | null {
	if (!target) return null;
	const selector = '.citation, cite, span.citation, div.citation, .cs1, .cs2';
	const citeEl = target.matches(selector)
		? target
		: target.querySelector<HTMLElement>(selector);
	if (!citeEl) return null;
	const classes = citeEl.classList;
	const hasCs2 = classes.contains('cs2');
	const hasCs1 = classes.contains('cs1') || classes.contains('csblue') || classes.contains('citation');
	const hasCsBlue = classes.contains('csblue');

	if (hasCs2) return { style: 'CS2', csblue: hasCsBlue, cite: citeEl };
	if (hasCs1) return { style: 'CS1', csblue: hasCsBlue, cite: citeEl };
	return null;
}

function collectCitations(): HTMLElement[] {
	const nodes = document.querySelectorAll<HTMLElement>('cite, span.citation, div.citation');
	console.info('[Cite Forge][Checks] Found citation nodes', { count: nodes.length });
	return Array.from(nodes);
}

function collectHarvInbound(): { inbound: Map<string, number>; count: number } {
	const inbound = new Map<string, number>();
	const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href^="#CITEREF"]');
	console.info('[Cite Forge][Checks] Found Harv backlinks', { count: anchors.length });
	anchors.forEach((a) => {
		const href = a.getAttribute('href') || '';
		const id = href.slice(1);
		const targetFound = annotateHarvErrors(a, id);
		if (!targetFound) return;
		inbound.set(id, (inbound.get(id) || 0) + 1);
	});
	return { inbound, count: anchors.length };
}

export function enableChecks(refs: Reference[]): void {
	console.info('[Cite Forge][Checks] Enabling checks', { refCount: refs.length });
	disableChecks();

	const items = collectCitations();
	const { inbound: harvInbound, count: harvBacklinkCount } = collectHarvInbound();
	annotateReferenceMetadata();
	annotateReferenceSorting();

	items.forEach((cite) => {
		const info = detectStyles(cite);
		if (!info) return;
		const { style, csblue, cite: citeNode } = info;

		const marker = document.createElement('span');
		marker.className = 'citeforge-check-marker';
		if (style === 'CS1') marker.classList.add('cs1');
		if (style === 'CS2') marker.classList.add('cs2');
		if (csblue) marker.classList.add('csblue');
		marker.textContent = style;

		citeNode.insertAdjacentElement('afterend', marker);

		markers.push({ marker, host: citeNode });
		console.info('[Cite Forge][Checks] Marker attached', {
			style,
			csblue,
			hostId: citeNode.id || null
		});

		const id = citeNode.getAttribute('id') || '';
		if (id.startsWith('CITEREF') && harvBacklinkCount > 0 && !harvInbound.get(id)) {
			const host = citeNode.parentElement || citeNode;
			appendAnnotation(host, `No link points to ${id}.`, 'warning');
		}
	});

	flushAnnotations();
	console.info('[Cite Forge][Checks] Enable complete', { markers: markers.length });
	active = markers.length > 0;
}

export function disableChecks(): void {
	if (markers.length) {
		console.info('[Cite Forge][Checks] Disabling checks, removing markers', { markers: markers.length });
	} else {
		console.info('[Cite Forge][Checks] Disabling checks, no markers to remove');
	}
	markers.forEach(({ marker }) => marker.remove());
	markers = [];
	active = false;
}

export function isChecksActive(): boolean {
	return active;
}
