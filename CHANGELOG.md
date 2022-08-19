# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.0.0-alpha.7](https://github.com/digidem/mapeo-map-server/compare/v1.0.0-alpha.6...v1.0.0-alpha.7) (2022-08-19)


### Features

* add import and import progress endpoints ([#33](https://github.com/digidem/mapeo-map-server/issues/33)) ([3b8843c](https://github.com/digidem/mapeo-map-server/commit/3b8843ccaf140708691d5a4eace4ce4ef23cccd4))
* add offline sprite support ([#42](https://github.com/digidem/mapeo-map-server/issues/42)) ([f13c6b9](https://github.com/digidem/mapeo-map-server/commit/f13c6b96cde2aaa5eedfbc99caa517f4daf9a3a0))
* html map previews for styles ([#55](https://github.com/digidem/mapeo-map-server/issues/55)) ([59f5117](https://github.com/digidem/mapeo-map-server/commit/59f5117141cd1626c2bba5330c7a3c06969c5f64))
* provide info on storage usage for styles ([#35](https://github.com/digidem/mapeo-map-server/issues/35)) ([27231b8](https://github.com/digidem/mapeo-map-server/commit/27231b8e133460306648dd44303a07a068006ebc))
* support glyphs ([#54](https://github.com/digidem/mapeo-map-server/issues/54)) ([c0d0231](https://github.com/digidem/mapeo-map-server/commit/c0d0231687d6563c69625c8cdd063273169c8cfd))
* support vector mbtiles imports ([#56](https://github.com/digidem/mapeo-map-server/issues/56)) ([eb1c2d9](https://github.com/digidem/mapeo-map-server/commit/eb1c2d913efc861494563a1e18b7cc2450301bdd))


### Bug Fixes

* delete deletable tilesets and tiles when deleting style ([#47](https://github.com/digidem/mapeo-map-server/issues/47)) ([2621c99](https://github.com/digidem/mapeo-map-server/commit/2621c99de3126249383bded6d1970cfae73c9d9c))
* disallow vector tile mbtiles imports ([#29](https://github.com/digidem/mapeo-map-server/issues/29)) ([2dbdc55](https://github.com/digidem/mapeo-map-server/commit/2dbdc55e7618630e377d3c7995b2c04d2a71dcbf))
* don't use ts-node for running tests ([#48](https://github.com/digidem/mapeo-map-server/issues/48)) ([17caf0e](https://github.com/digidem/mapeo-map-server/commit/17caf0e7048af2af0fc729c026d7212009400cf3))
* fix race condition with piscina and worker ([#38](https://github.com/digidem/mapeo-map-server/issues/38)) ([eb92a4c](https://github.com/digidem/mapeo-map-server/commit/eb92a4c6de36286eebe974e30dd144164e415089))
* Fix v8 error with graceful onClose cleanup ([#53](https://github.com/digidem/mapeo-map-server/issues/53)) ([91caaad](https://github.com/digidem/mapeo-map-server/commit/91caaad670c3621e3e7dcab5e82d6788128ee7b0))
* improve handling of multiple import requests using same file ([#30](https://github.com/digidem/mapeo-map-server/issues/30)) ([ef5ebed](https://github.com/digidem/mapeo-map-server/commit/ef5ebede0fec68cc0c097d38aaed13da559f3faa))
* instantiate api per instance instead of per request ([#51](https://github.com/digidem/mapeo-map-server/issues/51)) ([9c02d44](https://github.com/digidem/mapeo-map-server/commit/9c02d446566efd0d806afdcc7b7c56488a54cd70))
* manually send sse events ([#44](https://github.com/digidem/mapeo-map-server/issues/44)) ([295341b](https://github.com/digidem/mapeo-map-server/commit/295341b0f8ad086123289bea538dcfe8135e742a))
* properly handle upstream behavior for fetching tilesets ([#64](https://github.com/digidem/mapeo-map-server/issues/64)) ([d350318](https://github.com/digidem/mapeo-map-server/commit/d350318db719c2498da9a550c9fe33179fe5531a))
* remove stray style and tileset when import fails to start ([#59](https://github.com/digidem/mapeo-map-server/issues/59)) ([42bb98a](https://github.com/digidem/mapeo-map-server/commit/42bb98ab9450510d7a2fb2f1e71d5c17ce661706))
* return proper responses for get tile endpoint ([#62](https://github.com/digidem/mapeo-map-server/issues/62)) ([dd4539d](https://github.com/digidem/mapeo-map-server/commit/dd4539d7822c6f84123114a569a2b13b25bdaa85))
* use mbtiles file name as fallback style name when importing as new tileset ([#61](https://github.com/digidem/mapeo-map-server/issues/61)) ([bc7ffbc](https://github.com/digidem/mapeo-map-server/commit/bc7ffbc38060028173b9d85a5726b016da1a4a07))

## [1.0.0-alpha.6](https://github.com/digidem/mapeo-map-server/compare/v1.0.0-alpha.5...v1.0.0-alpha.6) (2022-05-30)


### Bug Fixes

* Fix style deletion (does not delete tilesets) ([191c0f3](https://github.com/digidem/mapeo-map-server/commit/191c0f325f135d17e44ab18b52a25905c3b3d165))

## [1.0.0-alpha.5](https://github.com/digidem/mapeo-map-server/compare/v1.0.0-alpha.4...v1.0.0-alpha.5) (2022-05-30)


### Bug Fixes

* fix mbtiles import ([f8a5dad](https://github.com/digidem/mapeo-map-server/commit/f8a5dadb025a953cb7970563cc8102c138865df0))
