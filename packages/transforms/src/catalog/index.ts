/** The registry Raven ships with (21_TRANSFORM_SYSTEM.md §4). */

import { createTransformRegistry, type TransformRegistry } from '../registry.ts';

import { ENGINES } from './engines.ts';
import { PROVIDERS } from './providers.ts';
import { TRANSFORMS } from './transforms.ts';

export { ENGINES, PROVIDERS, TRANSFORMS };

export const createCatalogRegistry = (): TransformRegistry =>
  createTransformRegistry({ transforms: TRANSFORMS, engines: ENGINES, providers: PROVIDERS });
