# Bundled map assets

`gazetteer.sqlite` is adapted from [GeoNames](https://www.geonames.org/) and redistributed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The 2026-11-19 snapshot merges the
`cities5000.zip` and `BY.zip` exports, keeps current populated places, adds Belarusian, Russian and
English names from `alternateNamesV2.zip`, and builds a full-text index. Source archives and their
formats are documented on the [GeoNames download page](https://download.geonames.org/export/dump/).

| Source archive         | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `BY.zip`               | `883d5ffa2f3b44a0714c0c99dfc8ff85eda5a36a4d6839a4688470073f7d368c` |
| `alternateNamesV2.zip` | `78f9083d97c3e484059c967ecbec5d141f22adf2bf25e855d06e63d052d44cd5` |
| `cities5000.zip`       | `589b8ce3731cc43e18ce1fe348909bfd0cc017db6421a642f395f7fe95bf7100` |

The nonempty Noto Sans Regular, Medium, Italic and Devanagari Regular v1 PBF ranges in `glyphs/` come from
[Protomaps basemaps-assets](https://github.com/protomaps/basemaps-assets/tree/028c18f713baecad011301ff7a69acc39bcc2ae7/fonts).
Their [SIL Open Font License](glyphs/OFL.txt) is bundled alongside them.

The `protomaps-light` and `protomaps-dark` sprite sheets come from the
[v4 Protomaps sprites](https://github.com/protomaps/basemaps-assets/tree/028c18f713baecad011301ff7a69acc39bcc2ae7/sprites/v4).
The [Tangram icons license](Tangram-icons-LICENSE.md) accompanies the sprites, and the [Protomaps code license](Protomaps-basemaps-LICENSE.txt)
accompanies the style package used by Herbarium.

The 1× and 2× sprite sheets adapt Herbarium's [plant icon](../src/lib/assets/favicon.svg), with
madder, cornflower and flax accents for moments, plans and occasions.
