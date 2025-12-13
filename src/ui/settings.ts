import { TransformOptions } from "../core/references";

/** User-configurable settings for Cite Forge. */
export type Settings = {
	/** Format used when copying reference names. */
	copyFormat: 'raw' | 'r' | 'ref';
	/** Whether to show the copy button on citation hover. */
	showCiteRefCopyBtn: boolean;
	/** Whether Cite Forge is enabled in User namespace. */
	showInUserNs: boolean;
	/** Placement strategy for references. */
	placementMode: 'keep' | 'all_inline' | 'all_ldr' | 'threshold';
	/** Threshold for LDR placement when placementMode is threshold. */
	minUsesForLdr: number;
	/** Prefer {{r}} for uses when possible. */
	useTemplateR: boolean;
	/** Do not dedupe identical refs; keep separate copies. */
	makeCopies: boolean;
	/** Normalize generated ref markup (trim/compact whitespace). */
	normalizeAll: boolean;
};

const SETTINGS_KEY = 'citeforge-settings';
let cachedSettings: Settings | null = null;

/** Default settings applied when no user settings exist. */
const DEFAULT_SETTINGS: Settings = {
	copyFormat: 'raw',
	showCiteRefCopyBtn: true,
	showInUserNs: true,
	placementMode: 'keep',
	minUsesForLdr: 2,
	useTemplateR: false,
	makeCopies: false,
	normalizeAll: false
};

/**
 * Load user settings from localStorage.
 * Returns cached settings if already loaded, otherwise reads from storage.
 * Falls back to defaults if storage is unavailable or corrupt.
 * @returns The current settings object.
 */
export function loadSettings(): Settings {
	if (cachedSettings) return cachedSettings;
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) {
			cachedSettings = { ...DEFAULT_SETTINGS };
			return cachedSettings;
		}
		const parsed = JSON.parse(raw) as Partial<Settings>;
		cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
		return cachedSettings;
	} catch {
		cachedSettings = { ...DEFAULT_SETTINGS };
		return cachedSettings;
	}
}

/**
 * Save updated settings to localStorage.
 * Merges the provided partial settings with current settings.
 * @param next - Partial settings object with values to update.
 */
export function saveSettings(next: Partial<Settings>): void {
	const current = loadSettings();
	cachedSettings = { ...current, ...next };
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(cachedSettings));
	} catch {
		/* ignore */
	}
}

/**
 * Get the current settings (alias for loadSettings).
 * @returns The current settings object.
 */
export function getSettings(): Settings {
	return loadSettings();
}

/**
 * Convert stored settings plus rename maps into transform options understood by the wikitext transformer.
 * @param settings - Cite Forge user settings.
 * @param renameMap - Mapping of existing ref names to their replacements (null to drop a name).
 * @param renameNameless - Mapping of ref IDs for unnamed refs to the names they should receive.
 * @returns A populated TransformOptions object.
 */
export function settingsToTransformOptions(
	settings: Settings,
	renameMap: Record<string, string | null>,
	renameNameless: Record<string, string | null>
): TransformOptions {
	const placementMode = (() => {
		if (settings.placementMode === 'keep') return 'keep' as const;
		if (settings.placementMode === 'all_inline') return 'all_inline' as const;
		if (settings.placementMode === 'all_ldr') return 'all_ldr' as const;
		const minUses = Math.max(1, Number(settings.minUsesForLdr) || 1);
		return { minUsesForLdr: minUses };
	})();
	const sortRefs = placementMode === 'all_ldr' || placementMode === 'threshold';

	return {
		renameMap,
		renameNameless,
		sortRefs,
		useTemplateR: Boolean(settings.useTemplateR),
		locationMode: placementMode,
		dedupe: !settings.makeCopies,
		normalizeAll: Boolean(settings.normalizeAll)
	};
}

/**
 * Check if Cite Forge should be enabled in the current namespace.
 * Allows mainspace (0), User (2 if enabled), and Draft namespaces.
 * Also checks that the page content model is wikitext.
 * @returns True if Cite Forge should be enabled.
 */
export function namespaceAllowed(): boolean {
	const ns = mw.config?.get('wgNamespaceNumber');
	const nsIds = mw.config?.get('wgNamespaceIds') || {};
	const allowed = ns === 0 || ns === 2 || (typeof nsIds?.draft === 'number' && ns === nsIds.draft);
	if (!allowed) return false;
	if (ns === 2) {
		const s = getSettings();
		if (!s.showInUserNs) return false;
	}
	const cm = mw.config?.get('wgPageContentModel');
	if (cm && cm !== 'wikitext') return false;
	return true;
}
