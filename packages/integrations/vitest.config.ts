import { nodeConfig, COVERAGE_TARGETS } from '@nexus/config/vitest';

export default nodeConfig({ coverage: COVERAGE_TARGETS['packages/integrations'] });
