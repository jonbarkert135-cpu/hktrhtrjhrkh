'use strict';

/**
 * R1 (10_INTEGRATIONS.md §1): the application core contains zero tool-specific code.
 *
 * `apps/api`, `apps/web/src/app` and `packages/canvas-engine` may not name a tool — not in an
 * identifier, not in a string literal, not in an import specifier. The rule is enforced from P9,
 * when only `expand-url` exists, precisely so P10–P12 cannot quietly regress it: the first
 * `if (integrationId === 'github')` in a router is the moment "add a tool" stops being "add a
 * manifest".
 *
 * Options:
 *   `tools`     — the identifiers to refuse (defaults to the known and planned first-party set);
 *   `corePaths` — regex sources; only files matching one of these are checked (the core, §5.13);
 *   `allowFiles`— regex sources; a matching file is skipped (tests, the integrations package).
 */

/** The core, exactly as §5.13 names it. Everything else may say a tool's name. */
const DEFAULT_CORE_PATHS = ['apps/api/', 'apps/web/src/app/', 'packages/canvas-engine/'];

const DEFAULT_TOOLS = ['github', 'sherlock', 'spiderfoot', 'expand-url', 'expandurl'];

const MESSAGE =
  'Tool identifier "{{name}}" must not appear in the application core. Behaviour comes from the manifest registry (@nexus/integrations) — 10_INTEGRATIONS.md R1.';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'the core is tool-agnostic; tool names live in packages/integrations' },
    schema: [
      {
        type: 'object',
        properties: {
          tools: { type: 'array', items: { type: 'string' } },
          corePaths: { type: 'array', items: { type: 'string' } },
          allowFiles: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: { toolName: MESSAGE },
  },
  create(context) {
    const options = context.options[0] || {};
    const tools = (options.tools || DEFAULT_TOOLS).map((tool) => tool.toLowerCase());
    const allow = (options.allowFiles || []).map((pattern) => new RegExp(pattern));
    const core = (options.corePaths || DEFAULT_CORE_PATHS).map((pattern) => new RegExp(pattern));
    const filename = (context.filename || context.getFilename() || '').replace(/\\/g, '/');
    if (!core.some((re) => re.test(filename))) return {};
    if (allow.some((re) => re.test(filename))) return {};

    /** A name matches when the tool appears as a whole word or as a camelCase segment. */
    const match = (raw) => {
      if (typeof raw !== 'string') return undefined;
      const haystack = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
      return tools.find((tool) => haystack.includes(tool.replace(/[^a-z0-9]+/g, '')));
    };

    const report = (node, name) => context.report({ node, messageId: 'toolName', data: { name } });

    return {
      Identifier(node) {
        const name = match(node.name);
        if (name !== undefined) report(node, name);
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        // Import specifiers are literals too; both are equally forbidden here.
        const name = match(node.value);
        if (name !== undefined) report(node, name);
      },
      TemplateElement(node) {
        const name = match(node.value.raw);
        if (name !== undefined) report(node, name);
      },
    };
  },
};

module.exports = {
  rule,
  DEFAULT_TOOLS,
  DEFAULT_CORE_PATHS,
  plugin: { rules: { 'no-tool-names-in-core': rule } },
};
