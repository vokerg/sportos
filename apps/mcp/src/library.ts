// In-process hosts bind the account from their own authenticated session.
// Importing this entry never starts stdio or reads operator environment bindings.
export { createServer } from './server.js';
export { AthleteReadService, assertRuntimeRole } from './service.js';
export type { Snapshot } from './contracts.js';
