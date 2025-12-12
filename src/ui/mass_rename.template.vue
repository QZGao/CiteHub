<template>
	<div class="citeforge-mass-rename-shell" v-if="open">
		<div class="citeforge-mass-rename-backdrop" @click="closeDialog"></div>
		<div class="citeforge-mass-rename-window" role="dialog" aria-modal="true" aria-label="Mass rename references">
			<header class="citeforge-mass-rename-header">
				<div>
					<div class="citeforge-mass-rename-title">Mass rename references</div>
					<div class="citeforge-mass-rename-subtitle">Generate ref names from template data.</div>
				</div>
				<div class="citeforge-mass-rename-header-actions">
					<cdx-button weight="quiet" size="small" @click.prevent="closeDialog">Close</cdx-button>
				</div>
			</header>
			<div class="citeforge-mass-rename-body">
				<section class="citeforge-mass-rename-controls">
					<cdx-field class="citeforge-mass-rename-field">
						<cdx-multiselect-lookup
							v-model:input-chips="fieldChips"
							v-model:selected="fieldSelection"
							v-model:input-value="fieldInput"
							:menu-items="fieldMenuItems"
							:menu-config="fieldMenuConfig"
							placeholder="Add naming parts..."
							@input="onFieldInput"
							@update:selected="onFieldSelection"
						>
							<template #no-results>
								No matching fields.
							</template>
						</cdx-multiselect-lookup>
						<template #label>
							Naming parts
						</template>
						<template #description>
							Combine fields (author, title, domain, work, phrase) to build names.
						</template>
					</cdx-field>
					<div class="citeforge-mass-rename-rowstack">
						<span class="citeforge-mass-rename-label">Collision suffix</span>
						<cdx-select
							class="citeforge-mass-rename-select"
							:menu-items="incrementOptions"
							v-model:selected="config.incrementStyle"
						/>
					</div>
					<div class="citeforge-mass-rename-rowstack">
						<span class="citeforge-mass-rename-label">Delimiter</span>
						<cdx-text-input
							class="citeforge-mass-rename-input"
							v-model="config.delimiter"
							aria-label="Delimiter"
						/>
						<cdx-checkbox v-model="config.delimiterConditional">
							Only after numbers
						</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-rowstack">
						<span class="citeforge-mass-rename-label">Space replacement</span>
						<cdx-text-input
							class="citeforge-mass-rename-input"
							v-model="config.replaceSpaceWith"
							placeholder="_"
							aria-label="Space replacement"
						/>
					</div>
					<div class="citeforge-mass-rename-rowstack citeforge-mass-rename-rowstack--wrap">
						<cdx-checkbox v-model="config.convertYearDigits">Convert non-ASCII digits</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-rowstack citeforge-mass-rename-rowstack--wrap">
						<cdx-checkbox v-model="config.lowercase">Lowercase</cdx-checkbox>
						<cdx-checkbox v-model="config.stripDiacritics">Remove diacritics</cdx-checkbox>
						<cdx-checkbox v-model="config.stripPunctuation">Remove punctuation</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-actions">
						<cdx-button size="small" weight="quiet" @click.prevent="regenerateSuggestions(true)">
							Regenerate
						</cdx-button>
						<cdx-button size="small" weight="quiet" @click.prevent="resetAll">
							Reset
						</cdx-button>
					</div>
				</section>
				<section class="citeforge-mass-rename-list">
					<div class="citeforge-mass-rename-toolbar">
						<input
							type="search"
							class="citeforge-mass-rename-search"
							:placeholder="'Filter references...'"
							:value="query"
							@input="onQueryInput"
						/>
						<cdx-checkbox v-model="showInactive">
							Show unselected
						</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-table">
						<div class="citeforge-mass-rename-row citeforge-mass-rename-head">
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--check"></div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--name">Reference</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--uses">Uses</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--suggest">Suggested name</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--actions"></div>
						</div>
						<div
							v-for="row in filteredRows"
							:key="row.ref.id"
							class="citeforge-mass-rename-row"
							:class="{ 'is-inactive': !row.active, 'has-error': !!row.error }"
						>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--check">
								<cdx-checkbox v-model="row.active" @change="onToggleRow(row)" />
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--name">
								<div class="citeforge-mass-rename-name">
									<span class="citeforge-mass-rename-name__label">{{ row.ref.name || '∅ nameless' }}</span>
									<span class="citeforge-mass-rename-name__bucket">{{ bucketFor(row) }}</span>
								</div>
								<div class="citeforge-mass-rename-snippet">{{ row.snippet || '(no inline content captured)' }}</div>
								<div class="citeforge-mass-rename-meta">
									<span
										v-if="row.metadata.author || row.metadata.last || row.metadata.first"
										class="citeforge-mass-rename-chip"
									>
										Author:
										{{
											row.metadata.author ||
												[row.metadata.first, row.metadata.last].filter(Boolean).join(' ') ||
												row.metadata.last
										}}
									</span>
									<span v-if="row.metadata.title" class="citeforge-mass-rename-chip">Title: {{ row.metadata.title }}</span>
									<span v-if="row.metadata.work" class="citeforge-mass-rename-chip">Work: {{ row.metadata.work }}</span>
									<span v-if="row.metadata.domain" class="citeforge-mass-rename-chip">Website: {{ row.metadata.domain }}</span>
									<span
										v-if="row.metadata.dateDisplay || row.metadata.year || row.metadata.textYear"
										class="citeforge-mass-rename-chip"
									>
										Date: {{ row.metadata.dateDisplay || row.metadata.year || row.metadata.textYear }}
									</span>
								</div>
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--uses">{{ row.ref.uses.length }}</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--suggest">
								<cdx-text-input
									:disabled="!row.active"
									:model-value="row.suggestion"
									@update:model-value="onSuggestionEdited(row, $event)"
									aria-label="Suggested reference name"
								/>
								<div class="citeforge-mass-rename-error" v-if="row.error">{{ row.error }}</div>
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--actions">
								<cdx-button size="small" weight="quiet" @click.prevent="regenerateRow(row)" :disabled="!row.active">
									Reapply
								</cdx-button>
							</div>
						</div>
						<div v-if="!filteredRows.length" class="citeforge-mass-rename-empty">
							No references match this filter.
						</div>
					</div>
				</section>
			</div>
			<footer class="citeforge-mass-rename-footer">
				<div class="citeforge-mass-rename-status">
					<span>{{ activeCount }} selected</span>
					<span v-if="hasConflicts">· {{ conflictCount }} conflicts</span>
				</div>
				<div class="citeforge-mass-rename-footer-actions">
					<cdx-button weight="quiet" @click.prevent="closeDialog">Cancel</cdx-button>
					<cdx-button weight="primary" :disabled="applyDisabled" @click.prevent="applyRenames">
						Send to inspector
					</cdx-button>
				</div>
			</footer>
		</div>
	</div>
</template>
