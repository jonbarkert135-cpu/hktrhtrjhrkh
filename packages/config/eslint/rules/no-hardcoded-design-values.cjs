'use strict';

/**
 * Design values (colors, sizes, durations) come from @nexus/ui tokens only.
 * Reports hex colors, raw px values (0, 0px and 1px allowed) and raw ms durations
 * in string literals, template literals and JSX style objects.
 *
 * Option `allowFiles`: array of regex source strings; a file whose path matches any of
 * them is skipped (token definition files, generated Tailwind preset, tests).
 * A single line can opt out with `// eslint-disable-next-line nexus/no-hardcoded-design-values`.
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const PX = /(?<![\w.-])(\d+(?:\.\d+)?)px\b/;
const MS = /(?<![\w.-])(\d+(?:\.\d+)?)m?s\b/;

const ALLOWED_PX = new Set(['0', '1']);

/** @returns {null | 'color' | 'size' | 'duration'} */
function classify(text) {
  if (HEX.test(text)) return 'color';
  const px = PX.exec(text);
  if (px && px[1] !== undefined && !ALLOWED_PX.has(px[1])) return 'size';
  const ms = MS.exec(text);
  if (ms && ms[1] !== undefined && Number(ms[1]) !== 0) return 'duration';
  return null;
}

const MESSAGES = {
  color: 'Hardcoded color "{{value}}". Use a @nexus/ui color token.',
  size: 'Hardcoded px value "{{value}}". Use a @nexus/ui spacing/size token (0 and 1px are allowed).',
  duration: 'Hardcoded duration "{{value}}". Use a @nexus/ui motion token.',
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'disallow hardcoded design values outside token files' },
    schema: [
      {
        type: 'object',
        properties: { allowFiles: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },
  create(context) {
    const options = context.options[0] || {};
    const allow = (options.allowFiles || []).map((p) => new RegExp(p));
    const filename = context.filename || context.getFilename();
    if (allow.some((re) => re.test(filename))) return {};

    const check = (node, text) => {
      if (typeof text !== 'string' || text.length === 0) return;
      const kind = classify(text);
      if (kind)
        context.report({ node, messageId: kind, data: { value: text.trim().slice(0, 40) } });
    };

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
      // style={{ padding: 8 }} — React treats a bare number as px
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return;
        const value = node.value;
        if (!value || value.type !== 'JSXExpressionContainer') return;
        const obj = value.expression;
        if (obj.type !== 'ObjectExpression') return;
        for (const prop of obj.properties) {
          if (prop.type !== 'Property') continue;
          const v = prop.value;
          if (v.type !== 'Literal' || typeof v.value !== 'number') continue;
          if (v.value === 0 || v.value === 1) continue;
          context.report({ node: v, messageId: 'size', data: { value: String(v.value) } });
        }
      },
    };
  },
};

module.exports = {
  rule,
  // plugin object so configs can reference the rule as `nexus/no-hardcoded-design-values`
  plugin: { rules: { 'no-hardcoded-design-values': rule } },
};
