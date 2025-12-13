/**
 * Open the standard MediaWiki diff view with provided wikitext, without saving.
 * Submits a hidden form to action=submit with wpDiff, letting the user review and save.
 */
export function openDiffPreview(newText: string, summary = '[[meta:Cite Forge|Cite Forge]]: reference adjustments'): void {
	const title = mw.config.get('wgPageName');
	const action = mw.util.getUrl(title, { action: 'submit' });
	const token = mw.user.tokens.get('csrfToken') || '+\\';
	const model = mw.config.get('wgPageContentModel') || 'wikitext';
	const form = document.createElement('form');
	form.method = 'post';
	form.action = action;
	form.target = '_blank';
	form.style.display = 'none';

	const textarea = document.createElement('textarea');
	textarea.name = 'wpTextbox1';
	textarea.value = newText;
	form.appendChild(textarea);

	appendHidden(form, 'wpSummary', summary);
	appendHidden(form, 'wpDiff', '1');
	appendHidden(form, 'wpEditToken', token);
	appendHidden(form, 'model', model);
	appendHidden(form, 'format', 'text/x-wiki');
	appendHidden(form, 'wpUltimateParam', '1');

	const startTs = mw.config.get('wgPageContentTimestamp') as string | undefined;
	if (startTs) {
		appendHidden(form, 'wpStarttime', startTs);
		appendHidden(form, 'wpEdittime', startTs);
	}

	document.body.appendChild(form);
	form.submit();
	form.remove();
}

function appendHidden(form: HTMLFormElement, name: string, value: string): void {
	const input = document.createElement('input');
	input.type = 'hidden';
	input.name = name;
	input.value = value;
	form.appendChild(input);
}

