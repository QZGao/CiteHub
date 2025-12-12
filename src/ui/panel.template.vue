<template>
	<div class="citeforge-shell" v-if="visible">
		<button class="citeforge-launcher" v-if="!open" type="button" @click.prevent="open = true"
			title="Open Cite Forge">
			<span class="citeforge-launcher__icon">✎</span>
			<span class="citeforge-launcher__label">Citations</span>
		</button>

		<div class="citeforge-panel" :class="{ 'is-open': open }">
			<div class="citeforge-panel__header">
				<div class="citeforge-panel__title">Cite Forge – Inspector</div>
				<div class="citeforge-panel__actions">
					<cdx-button weight="quiet" size="small" @click.prevent="closeDialog">
						Collapse
					</cdx-button>
				</div>
			</div>
			<div class="citeforge-panel__body">
				<div class="citeforge-panel__index">
					<button v-for="letter in ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '*']" :key="letter"
						type="button" class="citeforge-index-btn" :disabled="!firstByBucket[letter]"
						@click.prevent="scrollToBucket(letter)">
						{{ letter }}
					</button>
				</div>
				<div class="citeforge-panel__list">
					<div class="citeforge-list-topbar">
						<input class="citeforge-search" type="search" :placeholder="'Search citations…'"
							:aria-label="'Search citations'" :value="query" @input="onQueryInput" />
						<cdx-button weight="quiet" size="small" :title="'Refresh'" :aria-label="'Refresh'"
							@click.prevent="refreshList">
							<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
								<path fill="currentColor"
									d="M15.65 4.35A8 8 0 1 0 17.4 13h-2.22a6 6 0 1 1-1-7.22L11 9h7V2z" />
							</svg>
						</cdx-button>
					</div>
					<div v-if="hasRefs" class="citeforge-list-wrap">
						<div v-for="(reference, idx) in filteredRefs" :key="reference.id || idx"
							:id="idx === 0 || bucketFor(filteredRefs[idx - 1]) !== bucketFor(reference) ? 'citeforge-anchor-' + bucketFor(reference) : undefined"
							class="citeforge-row"
							:class="{ 'is-selected': selectedRef && selectedRef.id === reference.id, 'has-conflict': refHasConflict(reference) }"
							@click.prevent="selectRef(reference)">
							<div class="citeforge-row__title">
								<input v-if="editingRefId === reference.id" class="citeforge-row__name-input" type="text"
									:value="reference.name || ''" @blur="commitRefNameFromEvent(reference, $event)"
									@keydown.enter.prevent="commitRefNameFromEvent(reference, $event)"
									@keydown.escape.prevent="cancelEditRefName(reference)" @click.stop />
								<span v-else class="citeforge-row__name">
									<span v-if="!reference.name" class="citeforge-row__nameless"
										title="Unnamed reference">∅</span>
									{{ refName(reference) }}
								</span>
								<span class="citeforge-row__name-actions" v-if="editingRefId !== reference.id">
									<button class="citeforge-icon-btn" type="button"
										@click.stop.prevent="editRefName(reference)"
										:title="reference.name ? 'Edit ref name' : 'Name this reference'">
										<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
											<path fill="currentColor"
												d="m16.77 8 1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zM1 14.25V19h4.75l9.96-9.96-4.75-4.75z" />
										</svg>
									</button>
									<button v-if="reference.name" class="citeforge-icon-btn" type="button"
										@click.stop.prevent="copyRefName(reference)" title="Copy ref name">
										<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
											<path fill="currentColor"
												d="M3 3h8v2h2V3c0-1.1-.895-2-2-2H3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h2v-2H3z" />
											<path fill="currentColor"
												d="M9 9h8v8H9zm0-2c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h8c1.1 0 2-.895 2-2V9c0-1.1-.895-2-2-2z" />
										</svg>
									</button>
								</span>
								<span class="citeforge-row__meta">Uses: {{ refUses(reference) }} <span v-if="reference.group">· {{
									reference.group }}</span></span>
							</div>
							<div class="citeforge-row__snippet">{{ (reference.contentWikitext || '').slice(0, 200) || '(No inline content captured) ' }}</div>
							<div class="citeforge-row__actions">
								<button class="citeforge-copy-btn" type="button"
									@click.stop.prevent="copyRefContent(reference)" title="Copy raw content">
									<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
										<path fill="currentColor"
											d="M3 3h8v2h2V3c0-1.1-.895-2-2-2H3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h2v-2H3z" />
										<path fill="currentColor"
											d="M9 9h8v8H9zm0-2c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h8c1.1 0 2-.895 2-2V9c0-1.1-.895-2-2-2z" />
									</svg>
									<span>Copy raw</span>
								</button>
							</div>
						</div>
					</div>
					<div v-else class="citeforge-empty">No references found on this page.</div>
				</div>
				<div class="citeforge-panel__toolbar">
					<button v-if="hasPendingChanges" class="citeforge-tool-btn citeforge-tool-btn--primary"
						type="button" title="Save pending changes" @click.prevent="saveChanges">
						<span class="citeforge-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 16 16" width="16" height="16">
								<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"
									d="M15 6.12V11C15 12.06 14.58 13.08 13.83 13.83C13.08 14.58 12.06 15 11 15H5C4.91 15 4.82 14.99 4.74 14.98C4.66 14.97 4.58 14.96 4.5 14.93C4.32 14.89 4.15 14.82 4 14.73C3.92 14.68 3.85 14.64 3.78 14.58C3.64 14.48 3.52 14.36 3.42 14.22C3.36 14.15 3.32 14.08 3.27 14H11C11.35 14 11.69 13.94 12 13.82C12.42 13.68 12.8 13.44 13.12 13.12C13.68 12.56 14 11.8 14 11V4.3L14.41 4.71C14.79 5.08 15 5.6 15 6.12ZM11 13H3C1.897 13 1 12.103 1 11V3C1 1.897 1.897 1 3 1H9.879C10.405 1 10.921 1.213 11.293 1.586L12.414 2.707C12.787 3.079 13 3.595 13 4.121V11C13 12.103 12.103 13 11 13ZM5.999 3H8V2H5.999V3ZM9 8H5V12H9V8ZM10 8V12H11C11.551 12 12 11.551 12 11V4.121C12 3.858 11.893 3.6 11.707 3.414L10.586 2.293C10.4 2.107 10.142 2 9.879 2H9V3C9 3.551 8.551 4 8 4H6C5.449 4 5 3.551 5 3V2H3C2.449 2 2 2.449 2 3V11C2 11.551 2.449 12 3 12H4V8C4 7.449 4.449 7 5 7H9C9.551 7 10 7.449 10 8Z" />
							</svg>
						</span>
						<span class="citeforge-tool-label">Save ({{ pendingChanges.length }})</span>
					</button>
					<button class="citeforge-tool-btn" type="button" title="Settings" @click.prevent="toggleSettings">
						<span class="citeforge-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16" xmlns:xlink="http://www.w3.org/1999/xlink">
								<g transform="translate(10 10)">
									<path fill="currentColor" id="a" d="M1.5-10h-3l-1 6.5h5m0 7h-5l1 6.5h3" />
									<use xlink:href="#a" transform="rotate(45)" fill="currentColor" />
									<use xlink:href="#a" transform="rotate(90)" fill="currentColor" />
									<use xlink:href="#a" transform="rotate(135)" fill="currentColor" />
								</g>
								<path fill="currentColor"
									d="M10 2.5a7.5 7.5 0 0 0 0 15 7.5 7.5 0 0 0 0-15v4a3.5 3.5 0 0 1 0 7 3.5 3.5 0 0 1 0-7" />
							</svg>
						</span>
						<span class="citeforge-tool-label">Settings</span>
					</button>
					<button class="citeforge-tool-btn" type="button" title="Mass rename"
						@click.prevent="openMassRename">
						<span class="citeforge-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor"
									d="M6 3H5V1h1c.768 0 1.47.289 2 .764A3 3 0 0 1 10 1h1v2h-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h1v2h-1c-.768 0-1.47-.289-2-.764A3 3 0 0 1 6 19H5v-2h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1m6 12h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-6v2h6v6h-6zm-8-2v2H2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2v2H2v6z" />
							</svg>
						</span>
						<span class="citeforge-tool-label">Mass rename</span>
					</button>
					<button class="citeforge-tool-btn" type="button" title="Structure tools (soon)">
						<span class="citeforge-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor"
									d="M7 15h12v2H7zm0-6h12v2H7zm0-6h12v2H7zM2 6h1V1H1v1h1zm1 9v1H2v1h1v1H1v1h3v-5H1v1zM1 8v1h2v1H1.5a.5.5 0 0 0-.5.5V13h3v-1H2v-1h1.5a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5z" />
							</svg>
						</span>
						<span class="citeforge-tool-label">Structure</span>
					</button>
					<button class="citeforge-tool-btn" type="button" title="Checks (soon)">
						<span class="citeforge-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor"
									d="m.29 12.71 1.42-1.42 2.22 2.22 8.3-10.14 1.54 1.26-9.7 11.86zM12 10h5v2h-5zm-3 4h5v2H9zm6-8h5v2h-5z" />
							</svg>
						</span>
						<span class="citeforge-tool-label">Checks</span>
					</button>
				</div>
				<div class="citeforge-settings" v-if="showSettings">
					<div class="citeforge-settings__title">Cite Forge Settings</div>
					<div class="citeforge-settings__row citeforge-settings__row--stack">
						<span>Copy ref name format</span>
						<div class="citeforge-select-wrap">
							<cdx-select v-model:selected="settings.copyFormat" :menu-items="copyFormatOptions" />
						</div>
					</div>
					<cdx-checkbox v-model="settings.showCiteRefCopyBtn">
						Show citation hover copy popup
					</cdx-checkbox>
					<cdx-checkbox v-model="settings.showInUserNs">
						Enable in User namespace
					</cdx-checkbox>
					<div class="citeforge-settings__row citeforge-settings__row--stack">
						<span>Placement</span>
						<div class="citeforge-select-wrap">
							<cdx-select v-model:selected="settings.placementMode" :menu-items="placementOptions" />
						</div>
					</div>
					<div class="citeforge-settings__row" v-if="settings.placementMode === 'threshold'">
						<span>Minimum uses for reflist</span>
						<div class="citeforge-input-wrap">
							<cdx-text-input type="number" min="1" v-model.number="settings.minUsesForLdr" />
						</div>
					</div>
					<cdx-checkbox v-model="settings.sortRefs">
						Sort reflist entries
					</cdx-checkbox>
					<cdx-checkbox v-model="settings.useTemplateR">
						Prefer {{ '{' }}{r|name}} for uses
					</cdx-checkbox>
					<cdx-checkbox v-model="settings.makeCopies">
						Keep separate copies (no dedupe)
					</cdx-checkbox>
					<cdx-checkbox v-model="settings.normalizeAll">
						Normalize reference markup
					</cdx-checkbox>
					<div class="citeforge-settings__actions">
						<cdx-button weight="quiet" size="small" @click.prevent="saveSettings">
							Save
						</cdx-button>
						<cdx-button weight="quiet" size="small" @click.prevent="toggleSettings">
							Close
						</cdx-button>
					</div>
				</div>
			</div>
			<div class="citeforge-resizer" @mousedown.prevent="startResize"></div>
		</div>
	</div>
</template>
