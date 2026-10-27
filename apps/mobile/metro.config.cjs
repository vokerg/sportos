const { getDefaultConfig } = require('expo/metro-config');

// SDK 57 auto-detects pnpm workspaces. The pure shared API contract is imported
// by path, without adding any Angular, DOM, database, Node or worker dependencies.
module.exports = getDefaultConfig(__dirname);
