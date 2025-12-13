import { describe, it, expect } from 'vitest';
import { parseReferences, transformWikitext } from '../../src/core/references';

describe('parseReferences', () => {
	describe('named refs with content', () => {
		it('parses a simple named ref', () => {
			const wikitext = '<ref name="foo">Some citation content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('foo');
			expect(refs[0].contentWikitext).toBe('Some citation content');
			expect(refs[0].group).toBeNull();
		});

		it('parses named ref with double quotes', () => {
			const wikitext = '<ref name="my-source">Content here</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('my-source');
		});

		it('parses named ref with single quotes', () => {
			const wikitext = "<ref name='single-quoted'>Content</ref>";
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('single-quoted');
		});

		it('parses named ref without quotes', () => {
			const wikitext = '<ref name=unquoted>Content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('unquoted');
		});

		it('parses ref with group attribute', () => {
			const wikitext = '<ref name="foo" group="notes">A note</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('foo');
			expect(refs[0].group).toBe('notes');
		});
	});

	describe('self-closing refs', () => {
		it('parses self-closing named ref', () => {
			const wikitext = '<ref name="foo" />';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('foo');
			expect(refs[0].contentWikitext).toBe('');
		});

		it('parses self-closing ref without space before slash', () => {
			const wikitext = '<ref name="bar"/>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('bar');
		});

		it('parses self-closing ref with group', () => {
			const wikitext = '<ref name="foo" group="lower-alpha" />';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].group).toBe('lower-alpha');
		});
	});

	describe('multiple uses of same ref', () => {
		it('counts multiple uses of the same named ref', () => {
			const wikitext = `
				<ref name="source1">First source content</ref>
				Some text here.
				<ref name="source1" />
				More text.
				<ref name="source1" />
			`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('source1');
			expect(refs[0].uses.length).toBeGreaterThanOrEqual(3);
			expect(refs[0].contentWikitext).toBe('First source content');
		});

		it('preserves content from first definition', () => {
			const wikitext = `
				<ref name="myref">Original content</ref>
				<ref name="myref" />
			`;
			const refs = parseReferences(wikitext);

			expect(refs[0].contentWikitext).toBe('Original content');
		});
	});

	describe('{{r}} template syntax', () => {
		it('parses {{r|name}} template', () => {
			const wikitext = '{{r|Smith2020}}';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('Smith2020');
		});

		it('parses {{r|name=value}} template', () => {
			const wikitext = '{{r|name=Jones2019}}';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('Jones2019');
		});

		it('parses multiple r templates', () => {
			const wikitext = 'Text{{r|ref1}}more{{r|ref2}}end';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(2);
			expect(refs.map((r) => r.name)).toContain('ref1');
			expect(refs.map((r) => r.name)).toContain('ref2');
		});

		it('parses chained r template names', () => {
			const wikitext = '{{r|bilibili-05|sohu-02|dualshockers-01}}';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(3);
			expect(refs.map((r) => r.name)).toEqual(expect.arrayContaining(['bilibili-05', 'sohu-02', 'dualshockers-01']));
		});

		it('parses chained r template names with multiple segments', () => {
			const wikitext = '{{r|yicai-01|io.gov.mo-01}}';
			const refs = parseReferences(wikitext);
			expect(refs.map((r) => r.name)).toEqual(expect.arrayContaining(['yicai-01', 'io.gov.mo-01']));
		});
	});

	describe('unnamed refs', () => {
		it('parses unnamed ref with content', () => {
			const wikitext = '<ref>Anonymous citation</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBeNull();
			expect(refs[0].contentWikitext).toBe('Anonymous citation');
		});

		it('assigns unique IDs to multiple unnamed refs', () => {
			const wikitext = `
				<ref>First unnamed</ref>
				<ref>Second unnamed</ref>
			`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(2);
			expect(refs[0].id).not.toBe(refs[1].id);
		});
	});

	describe('sanitization', () => {
		it('ignores refs inside HTML comments', () => {
			const wikitext = `
				<ref name="visible">Real ref</ref>
				<!-- <ref name="hidden">Commented out</ref> -->
			`;
			const refs = parseReferences(wikitext);

			const names = refs.map((r) => r.name);
			expect(names).toContain('visible');
			expect(names).not.toContain('hidden');
		});

		it('ignores refs inside nowiki tags', () => {
			const wikitext = `
				<ref name="real">Content</ref>
				<nowiki><ref name="fake">Not a ref</ref></nowiki>
			`;
			const refs = parseReferences(wikitext);

			const names = refs.map((r) => r.name);
			expect(names).toContain('real');
			expect(names).not.toContain('fake');
		});

		it('ignores refs inside pre tags', () => {
			const wikitext = `
				<ref name="actual">Real</ref>
				<pre><ref name="example">Code example</ref></pre>
			`;
			const refs = parseReferences(wikitext);

			const names = refs.map((r) => r.name);
			expect(names).toContain('actual');
			expect(names).not.toContain('example');
		});
	});

	describe('complex wikitext', () => {
		it('handles mixed ref formats', () => {
			const wikitext = `
				According to sources<ref name="Smith2020">Smith, J. (2020)</ref>, 
				this is true.<ref name="Smith2020" /> See also<ref>Anonymous</ref> 
				and {{r|Jones2019}}.
			`;
			const refs = parseReferences(wikitext);

			expect(refs.length).toBeGreaterThanOrEqual(3);

			const smith = refs.find((r) => r.name === 'Smith2020');
			expect(smith).toBeDefined();
			expect(smith!.contentWikitext).toBe('Smith, J. (2020)');

			const jones = refs.find((r) => r.name === 'Jones2019');
			expect(jones).toBeDefined();
		});

		it('handles refs with complex content', () => {
			const wikitext = `<ref name="complex">{{cite web |url=https://example.com |title=Example}}</ref>`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].contentWikitext).toContain('cite web');
			expect(refs[0].contentWikitext).toContain('https://example.com');
		});

		it('handles multiline ref content', () => {
			const wikitext = `<ref name="multiline">
				{{cite book
				|author=John Doe
				|title=My Book
				|year=2020
				}}
			</ref>`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].contentWikitext).toContain('cite book');
			expect(refs[0].contentWikitext).toContain('John Doe');
		});
	});

	describe('edge cases', () => {
		it('returns empty array for empty string', () => {
			const refs = parseReferences('');
			expect(refs).toHaveLength(0);
		});

		it('returns empty array for text without refs', () => {
			const refs = parseReferences('Just some plain text without any references.');
			expect(refs).toHaveLength(0);
		});

		it('handles refs with special characters in names', () => {
			const wikitext = '<ref name="O\'Brien_2020">Content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
		});

		it('handles refs with spaces in name attribute', () => {
			const wikitext = '<ref name = "spaced" >Content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('spaced');
		});

		it('handles refs with slashes in names', () => {
			const wikitext = '<ref name="WP:RS/AC">Wikipedia reliable sources</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('WP:RS/AC');
			expect(refs[0].contentWikitext).toBe('Wikipedia reliable sources');
		});

		it('handles self-closing refs with slashes in names', () => {
			const wikitext = '<ref name="Category:Foo/Bar" />';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('Category:Foo/Bar');
		});

		it('handles multiple slashes in ref name', () => {
			const wikitext = '<ref name="a/b/c/d">Nested path ref</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('a/b/c/d');
		});
	});
});


describe('transformWikitext', () => {
	it('keeps wikitext unchanged when no transformations are specified', () => {
		const source = `
Intro <ref name="unchanged" /> mid <ref name="unchanged" /> end.<ref name="another-unchanged" />

==References==
{{reflist|refs=
<!-- No changes should be made here -->
<ref name="unchanged">This reference stays the same.</ref>
<ref name="another-unchanged">Another stable reference.</ref>
<!-- Even comments should remain intact. -->
}}
`;
		const result = transformWikitext(source, {});
		expect(result.wikitext).toBe(source); // No changes should be made, even for the comments in reflist
	});

	it('keeps wikitext positionally unchanged when only renaming is specified', () => {
		const source = `
Intro <ref name="unchanged" /> mid <ref name="unchanged" /> end.<ref name="another-unchanged" />

==References==
{{reflist|refs=
<!-- No changes should be made here -->
<ref name="unchanged">This reference stays the same.</ref>
<ref name="another-unchanged">Another stable reference.</ref>
<!-- Even comments should remain intact. -->
}}
`;
		const result = transformWikitext(source, {
			renameMap: { unchanged: 'still-unchanged', 'another-unchanged': 'also-unchanged' }
		});
		expect(result.wikitext).toBe(source.replace(/name="unchanged"/g, 'name="still-unchanged"').replace(/name="another-unchanged"/g, 'name="also-unchanged"'));
	});

	it('keeps wikitext positionally unchanged when only templateR is toggled, on or off', () => {
		const source1 = `
Intro <ref name="unchanged" /> mid <ref name="unchanged" /> end.<ref name="another-unchanged" />

==References==
{{reflist|refs=
<!-- No changes should be made here -->
<ref name="unchanged">This reference stays the same.</ref>
<ref name="another-unchanged">Another stable reference.</ref>
<!-- Even comments should remain intact. -->
}}
`;
		const source2 = source1.replace(/<ref name="unchanged" \/>/g, '{{r|unchanged}}').replace(/<ref name="another-unchanged" \/>/g, '{{r|another-unchanged}}');

		const result1 = transformWikitext(source1, { useTemplateR: true });
		expect(result1.wikitext).toBe(source2);

		const result2 = transformWikitext(source2, { useTemplateR: false });
		expect(result2.wikitext).toBe(source1);
	});

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

	it('preserves r-template page params alongside renamed refs', () => {
		const source = 'See {{r|foo|p=2|bar|p2=8-9}} for pages.';
		const result = transformWikitext(source, {
			renameMap: { foo: 'FooRenamed', bar: 'BarRenamed' },
			useTemplateR: true
		});

		expect(result.wikitext).toContain('{{r|FooRenamed|p=2|BarRenamed|p2=8-9}}');
	});

	it('converts r templates with only name/group to refs when templateR is off', () => {
		const source = 'See {{r|foo|grp=baz}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="baz" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('converts chained r templates with only name/group to refs when templateR is off', () => {
		const source = 'See {{r|n1=foo|grp=g1|bar|group=g2}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />');
		expect(result.wikitext).toContain('<ref name="bar" group="g2" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('converts refs with only name/group to r templates when templateR is on', () => {
		const source = 'See <ref name="foo" group="baz" />.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=baz}}');
		expect(result.wikitext).not.toContain('<ref ');
	});

	it('converts chained refs with only name/group to r templates when templateR is on', () => {
		const source = 'See <ref name="foo" group="g1" /><ref name="bar" group="g2" />.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=g1|bar|group=g2}}');
		expect(result.wikitext).not.toContain('<ref ');
	});

	it('converts r templates with page params to ref + rp when templateR is off', () => {
		const source = 'See {{r|foo|p=2}} and {{r|bar|pp=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pp=4-5}}');
	});

	it('combines refs with rp back into r when templateR is on', () => {
		const source = 'See <ref name="foo" />{{rp|p=3}} and <ref name="bar" group="g" />{{rp|pp=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toMatch(/\{\{r\|foo\|p=3\}\}/);
		expect(result.wikitext).toMatch(/\{\{r\|bar\|group=g\|pp=4-5\}\}/);
	});

	it('combines chained refs with rp back into r when templateR is on', () => {
		const source = 'See <ref name="foo" />{{rp|p=2}}<ref name="bar" group="g" />{{rp|pp=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|p=2|bar|group2=g|pp2=4-5}}');
	});

	it('combines chained refs with rp back into r when templateR is on, longer example', () => {
		const source = 'See <ref name="foo" group="g1" />{{rp|p=2}}<ref name="bar" />{{rp|pp=4-5}}<ref name="baz" />{{rp|loc=fig1}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=g1|p=2|bar|pp2=4-5|baz|loc3=fig1}}');
	});

	it('keeps r templates with unsupported params when conversion would drop data', () => {
		const source = 'See {{r|foo|lang=en|p=2}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('{{r|foo|lang=en|p=2}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones', () => {
		const source = 'See {{r|foo|p=2|bar|lang2=en}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, longer example', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|lang2=en|baz|pp3=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en}}');  // lang2 is unconvertible, so stays as r, but the index is removed
		expect(result.wikitext).toContain('<ref name="baz" />{{rp|pp=4-5}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, even longer example', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|lang2=en|baz|test3=4-5|fourth}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en|baz|test2=4-5}}');  // lang2 and test3 are unconvertible, so stay as r, but the indices are removed and renumbered; the two unconvertible stay chained
		expect(result.wikitext).toContain('<ref name="fourth" />');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, when param order is mixed', () => {
		const source = 'See {{r|foo|lang2=en|lang3=fr|bar|pp=4-5|baz}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|pp=4-5}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en|baz|lang2=fr}}'); // lang2 and lang3 are unconvertible, so stay as r, but the indices are removed and renumbered; the two unconvertible stay chained
	});

	it('converts chained r with only name/group/page/pages/at into refs + rp when templateR is off', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|grp2=g2|pp2=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" group="g2" />{{rp|pp=4-5}}');
	});

	it('converts chained r with only name/group/page/pages/at into refs + rp when templateR is off, even when param order is mixed', () => {
		const source = 'See {{r|foo|pp2=10-12|grp=g1|at3=fig1|bar|p=2|third}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pp=10-12}}');
		expect(result.wikitext).toContain('<ref name="third" />{{rp|at=fig1}}');
	});

	it('recognizes name and its aliases when converting r to refs', () => {
		const source = 'See {{r|n1=foo|name2=bar|grp=g1|p=2|pages2=10-12|at3=fig1|3=baz}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pages=10-12}}');
		expect(result.wikitext).toContain('<ref name="baz" />{{rp|at=fig1}}');
	});

	it('does not populate r-template params beyond what is associated with a ref', () => {
		const source = 'See {{r|eurogamer_20110728|p=2|youxichaguan_20231130}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|eurogamer_20110728|p=2|youxichaguan_20231130}}');
	});

	it('does not remove line breaks', () => {
		const source = `| MC = PC：83/100{{r|metacritic_pc}}<br />{{tooltip|PS3|PlayStation 3}}：81/100{{r|metacritic_playstation-3}}
| OC = 76%{{r|opencritic}}`
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toBe(source);
	});

	it('renames and preserves all r-template aliases and indexed params when templateR is on', () => {
		const source = 'See {{r|name=alpha|grp=g1|p=2|pages2=10-12|at3=fig1}}.';
		const result = transformWikitext(source, {
			renameMap: { alpha: 'alpha-renamed' },
			useTemplateR: true
		});
		expect(result.wikitext).toContain('{{r|name=alpha-renamed|grp=g1|p=2|pages2=10-12|at3=fig1}}');
	});

	it('removes a ref name when mapped to null', () => {
		const source = 'Inline <ref name="temp">Body text</ref> end';
		const result = transformWikitext(source, {
			renameMap: { temp: null },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref>Body text</ref>');
		expect(result.wikitext).not.toContain('name="temp"');
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

	it('normalizes ref content', () => {
		const source = 'This is a reference: <ref name="metacritic">{{Cite web|title=Gamersky|url=https://www.metacritic.com/publication/gamersky/|website=www.metacritic.com|language=en|access-date=2024-04-06|archive-date=2024-06-21|archive-url=https://web.archive.org/web/20240621172355/https://www.metacritic.com/publication/gamersky/|dead-url=no}}</ref>';
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toContain('<ref name="metacritic">{{Cite web |title=Gamersky |url=https://www.metacritic.com/publication/gamersky/ |website=www.metacritic.com |language=en |dead-url=no |archive-url=https://web.archive.org/web/20240621172355/https://www.metacritic.com/publication/gamersky/ |archive-date=2024-06-21 |access-date=2024-04-06}}</ref>');
	});
});
