const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// The one imported shared file is a pure TypeScript contract outside the mobile root.
// Expo SDK 57 normally handles monorepos automatically; this exception makes
// that file visible while the app is an isolated workspace (#188).
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../..')];
module.exports = config;
