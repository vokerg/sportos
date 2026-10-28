# Native maps (#191)

Investigation: AGENTS.md; README.md; docs/ARCHITECTURE.md, ROADMAP.md,
AUTHENTICATION.md, AI_ANALYSIS.md, ACTIVITIES.md, adr/0011-react-native-expo-ios.md;
apps/mobile README, package/app config, App, auth SessionProvider/native/url policy,
navigation, Features, activity contracts/screens, UI primitives/theme;
packages/shared/src/mobile-api.ts; web heatmap models/transport/style;
API heatmap controller and activities/activity-route.ts. Compared the sibling
Personal Context Engine mobile package/app configuration, session/native appearance
and native auth. Reviewed epic/child issues and merged #198–#202; no active claims.
ADR early auth/placeholder gates predate merged native code.

MapLibre Native 11.5 is used in an Expo development build, with its config plugin.
Native line/heatmap layers share in-memory retained GeoJSON. No provider call,
GPS permission, local private-data cache, API change or scoring operation.
OSM raster tiles show mandatory attribution; tile requests necessarily disclose
viewed tile areas to OSM. Route coordinates/credentials are never sent as tile
request parameters. Native map logs are suppressed. Maps unmount on blur.

Route view preserves MultiLineString recording gaps, fits bounds and marks the
recorded start/finish. Indoor pools expose no route button and the server independently
returns an unavailable reason. Missing/invalid GPS is explicit.

Heatmap deliberately bounds phone rendering to two user-requested pages, 50 routes,
75,000 points and 15,000 density cells. Each route counts once per occupied 0.001°
cell, avoiding sample-rate-weighted density. The legend describes route presence,
not activity effort/distance or a complete archive. Coverage reports omitted routes.
30/90/365-day and sport filters use local calendar dates. Source resolution is
retained; no interpolation across recording gaps. Failed pages can be reloaded.

Validation so far: 29 mobile Node tests and mobile TypeScript pass. Tests cover
projection privacy, malformed/oversized/out-of-range GPS, gaps, bounds, density
route weights, pools and bounded cursors. Native simulator build and rendering
verification are in progress. Physical-device/signing validation remains #195.
