import { describe, it, expect } from 'vitest';
import { transformWikitext } from '../../src/core/wikitext_transforms';

describe('wikitextTransforms', () => {
	it('renames references across inline, self-closing, template r, and LDR definitions', () => {
		const source = `
Intro <ref name="foo">Alpha</ref> mid {{r|foo}} end <ref name="foo" />
Trailing use <ref name="bar" />

==References==
{{reflist|refs=
<ref name="bar">Bravo</ref>
}}
`;

		const result = transformWikitext(source, {
			renameMap: { foo: 'Foo2020', bar: 'Bar2021' },
			locationMode: 'all_inline',
			useTemplateR: true
		});

	expect(result.wikitext).toContain('<ref name="Foo2020">Alpha</ref>');
	expect(result.wikitext).toContain('{{r|Foo2020}}');
	expect(result.wikitext).toContain('<ref name="Bar2021">Bravo</ref>');
	expect(result.wikitext).not.toContain('name="foo"');
	expect(result.wikitext).not.toContain('name="bar"');
});

	it('moves inline definitions to LDR and converts uses to self-closing', () => {
		const source = `
Text <ref name="c">Content C</ref> more <ref name="c" />

{{reflist}}
`;

		const result = transformWikitext(source, {
			locationMode: 'all_ldr',
			sortRefs: true
		});

		expect(result.wikitext).toContain('{{reflist|refs=');
		expect(result.wikitext).toContain('<ref name="c" />');
		expect(result.wikitext).toContain('<ref name="c">Content C</ref>');
	});

	it('moves LDR definitions back inline at first use', () => {
		const source = `
Intro <ref name="d" /> mid {{r|d}}

{{reflist|refs=
<ref name="d">Delta</ref>
}}
`;

		const result = transformWikitext(source, {
			locationMode: 'all_inline'
		});

	expect(result.wikitext).toContain('<ref name="d">Delta</ref>');
	// Subsequent uses can remain {{r}} or ref; ensure the name was updated and reflist cleared
	expect(result.wikitext).toMatch(/({{r\|d}}|<ref name="d" \/>)/);
	expect(result.wikitext).not.toContain('|refs=');
});

	it('deduplicates identical reference content and unifies names', () => {
		const source = `
<ref name="x">Same content</ref> text <ref name="y">Same content</ref>

{{reflist}}
`;

		const result = transformWikitext(source, {
			dedupe: true,
			locationMode: 'all_ldr',
			sortRefs: true
		});

		expect(result.wikitext).toContain('<ref name="x" />');
		expect(result.wikitext).toContain('{{reflist|refs=');
		expect(result.wikitext).toContain('<ref name="x">Same content</ref>');
		expect(result.wikitext).not.toContain('name="y">');
		expect(result.changes.deduped).toContainEqual({ from: 'y', to: 'x' });
	});

	it('applies threshold-based LDR placement', () => {
		const source = `
First <ref name="rare">Only once</ref>
Repeat <ref name="common">Common content</ref> and again <ref name="common" />

{{reflist}}
`;

		const result = transformWikitext(source, {
			locationMode: { minUsesForLdr: 2 },
			sortRefs: true
		});

		// "common" should be in LDR because it has 2 uses
		expect(result.wikitext).toContain('{{reflist|refs=');
		expect(result.wikitext).toContain('<ref name="common" />');
		expect(result.wikitext).toContain('<ref name="common">Common content</ref>');
		// "rare" should stay inline
		expect(result.wikitext).toContain('<ref name="rare">Only once</ref>');
	});

	it('handles chained r templates when renaming', () => {
		const source = 'See {{r|bilibili-05|sohu-02|dualshockers-01}} for details.';
		const result = transformWikitext(source, {
			renameMap: {
				'bilibili-05': 'bilibili-renamed',
				'sohu-02': 'sohu-renamed',
				'dualshockers-01': 'dualshockers-renamed'
			},
			useTemplateR: true
		});

		expect(result.wikitext).toContain('{{r|bilibili-renamed|sohu-renamed|dualshockers-renamed}}');
	});

	it('names an unnamed reference via renameNameless', () => {
		const source = 'Intro <ref>Nameless content</ref>';
		const result = transformWikitext(source, {
			renameNameless: { __nameless_0: 'NamedRef' },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="NamedRef">Nameless content</ref>');
	});

	it('names one of multiple unnamed references', () => {
		const source = 'First <ref>Uno</ref> Second <ref>Dos</ref> Third <ref>Tres</ref>';
		const result = transformWikitext(source, {
			renameNameless: { __nameless_1: 'SecondRef' },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="SecondRef">Dos</ref>');
		expect(result.wikitext).toContain('<ref>Uno</ref>');
		expect(result.wikitext).toContain('<ref>Tres</ref>');
	});

	it('names multiple unnamed references in order when not explicitly keyed', () => {
		const source = 'First <ref>Uno</ref> Second <ref>Dos</ref> Third <ref> Tres </ref>';
		const result = transformWikitext(source, {
			renameNameless: { a: 'RefA', b: 'RefB' },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="RefA">Uno</ref>');
		expect(result.wikitext).toContain('<ref name="RefB">Dos</ref>');
		expect(result.wikitext).toContain('<ref>Tres</ref>');
	});
});
