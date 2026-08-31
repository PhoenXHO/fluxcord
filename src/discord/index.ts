/**
 * Bridge barrel: the Discord binding for the fluxcord runtime.
 *
 * @module discord
 */

export { createUiBridge } from './platform.js';
export type { UiBridge } from './platform.js';
export { flattenInteraction } from './flatten.js';
export type { NewUiComponentInteraction } from './flatten.js';
export { setUiHost, uiHost } from './ui-host.js';
export type { UiHost } from './ui-host.js';
export { deriveUiCommand } from './derive.js';
export type { DerivedCommand } from './derive.js';
export type { BridgeLogger, BridgeOptions } from './platform.js';
