/**
 * fluxcord: the platform-free core.
 *
 * Everything a bot needs except the platform itself: the authoring
 * factories (flow, screen, subview, action, command), the host
 * assembly API (buildFlowCatalog, createUiRuntime), and the seam
 * vocabulary (events, policies, payloads). The Discord binding lives
 * behind the 'fluxcord/discord' entry; TSX compiles against
 * 'fluxcord/jsx-runtime'.
 *
 * @module fluxcord
 */

// Authoring: what flow and command authors write.
export * from './flow/define.js'; // defineFlow, subflow
export * from './flow/token.js'; // flow, Flow, FlowMeta
export * from './flow/screen.js'; // screen, subview
export * from './flow/types.js'; // Screen, FlowOptions, FlowDefinition
export * from './pipeline/action.js'; // action
export * from './command/declare.js'; // command, mounts, Command
export * from './command/harvest.js'; // moduleFlowRegistrations, FlowSourceModule
export * from './flow/expiry.js'; // expiryEpoch, Expiry

// Host assembly: what the composition root writes.
export * from './boot/build.js'; // buildFlowCatalog, FlowCatalog, FlowRegistration
export * from './boot/scan.js'; // coverageScan
export * from './runtime/create.js'; // createUiRuntime
export * from './runtime/types.js'; // UiRuntime, RuntimeOptions, MountTarget
export * from './flow/registry.js'; // asScreenRegistry, screenEntries
export * from './commit/commit.js'; // createCommit, viewOf (advanced)
export * from './state/store.js'; // createSessionStore, SessionStore (advanced)

// Seams: the vocabulary crossing host boundaries.
export * from './pipeline/types.js'; // EventKind, ErrorSource, policy vocab, ports
export * from './pipeline/dispatch.js'; // defaultOnError, DEFAULT_ERROR_MESSAGE, createDispatch
export * from './state/types.js'; // Session, MessageRef, EndReason
export * from './render/v2.js'; // V2MessagePayload, V2ModalPayload, RenderError
export * from './render/id-codec.js'; // isActionId, encodeActionId, decodeActionId

// Tree vocabulary: node types, builders, kit, validation.
export * from './tree/vocab.js'; // NodeKind, ButtonStyle & InputStyle unions, SelectEntity
export * from './tree/types.js'; // ViewNode, ButtonNode, ...
export * from './tree/builders.js'; // view, text, row, button, ...
export * from './tree/kit.js'; // ScreenKit, runtimeKit
export * from './tree/validate.js'; // validateTree, Violation
