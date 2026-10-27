const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Only the framework-neutral mobile API contract is imported from outside this app.
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../..')];
module.exports = config;
