'use strict';

/**
 * N5 / R4 (10_INTEGRATIONS.md §1, 18_TESTING.md §7): tools execute in the runner sandbox, never in
 * the API, the worker or the web app. A `child_process` import outside `apps/runner` is a second,
 * unreviewed door into the host — the exact thing the sandbox exists to prevent.
 *
 * Reported: any import of `child_process`/`node:child_process`, and any `require('child_process')`
 * or container-exec library (`dockerode`, `execa`) outside the allowed files.
 */

const FORBIDDEN_MODULES = ['child_process', 'node:child_process', 'dockerode', 'execa'];

const MESSAGE =
  'Do not import "{{name}}" here. Only apps/runner may spawn a process (N5) — 10_INTEGRATIONS.md §6.';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'only apps/runner may spawn processes' },
    schema: [
      {
        type: 'object',
        properties: {
          allowFiles: { type: 'array', items: { type: 'string' } },
          modules: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: { forbidden: MESSAGE },
  },
  create(context) {
    const options = context.options[0] || {};
    const modules = new Set(options.modules || FORBIDDEN_MODULES);
    const allow = (options.allowFiles || []).map((pattern) => new RegExp(pattern));
    const filename = (context.filename || context.getFilename() || '').replace(/\\/g, '/');
    if (allow.some((re) => re.test(filename))) return {};

    const check = (node, value) => {
      if (typeof value === 'string' && modules.has(value)) {
        context.report({ node, messageId: 'forbidden', data: { name: value } });
      }
    };

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },
      CallExpression(node) {
        const callee = node.callee;
        const isRequire = callee.type === 'Identifier' && callee.name === 'require';
        const first = node.arguments[0];
        if (isRequire && first && first.type === 'Literal') check(node, first.value);
      },
    };
  },
};

module.exports = {
  rule,
  FORBIDDEN_MODULES,
  plugin: { rules: { 'no-child-process-in-api': rule } },
};
