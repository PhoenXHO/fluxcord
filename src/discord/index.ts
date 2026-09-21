/**
 * Bridge barrel: the Discord binding for the fluxcord runtime.
 *
 * @module discord
 */

export { createUiBridge } from './platform.js';
export type { UiBridge } from './platform.js';
export { flattenInteraction } from './flatten.js';
export type { UiComponentInteraction } from './flatten.js';
export { setUiHost, uiHost } from './ui-host.js';
export type { UiHost } from './ui-host.js';
export { deriveCommand } from './derive.js';
export type { DerivedCommand } from './derive.js';
export { createBot } from './create-bot.js';
export type { Bot, CreateBotOptions, CommandRegistration } from './create-bot.js';
export type { BridgeLogger, BridgeOptions } from './platform.js';
