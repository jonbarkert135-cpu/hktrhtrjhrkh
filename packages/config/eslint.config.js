import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { node } = require('./eslint/index.cjs');

export default [...node, { ignores: ['eslint/**', 'tsconfig/**'] }];
