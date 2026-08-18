/**
 * `person` — an identity under investigation (06_NODE_SYSTEM.md §4.7). Usernames and emails are
 * arrays because an identity is exactly the set of handles that were observed, and the identity
 * keys below are what lets P7's dedupe propose a merge instead of silently performing one.
 */

import { z } from 'zod';

import { clean, defineNodeType, jsonIo, keywords, nullableText } from '../define.ts';
import type { NodeTypeDefinition } from '../types.ts';

export const PersonDataSchema = z
  .object({
    displayName: z.string().max(300).default(''),
    usernames: z.array(z.string().max(200)).max(64).default([]),
    emails: z.array(z.string().max(320)).max(64).default([]),
    notes: nullableText(4000),
    organization: nullableText(200),
    location: nullableText(200),
  })
  .passthrough();

export type PersonData = z.infer<typeof PersonDataSchema>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const personType: NodeTypeDefinition<PersonData> = defineNodeType<PersonData>({
  type: 'person',
  label: 'Person',
  labelPlural: 'People',
  schema: PersonDataSchema,
  glyph: { colorToken: '--entity-person-fg', icon: 'user', shape: 'circle' },
  defaults: {
    size: { w: 280, h: 148 },
    minSize: { w: 200, h: 96 },
    maxSize: { w: 640, h: 560 },
    resize: 'width',
    autoHeight: true,
    data: PersonDataSchema.parse({}),
  },
  capabilities: {
    editableText: false,
    resizable: true,
    connectable: true,
    groupable: true,
    enrichable: true,
    duplicatable: true,
    hasMedia: false,
    aiSummarizable: true,
  },
  componentId: 'node.person',
  inspector: [
    {
      key: 'data.displayName',
      label: 'Name',
      control: 'text',
      section: 'identity',
      required: true,
    },
    { key: 'data.usernames', label: 'Usernames', control: 'multiselect', section: 'identity' },
    { key: 'data.emails', label: 'Emails', control: 'multiselect', section: 'identity' },
    { key: 'data.organization', label: 'Organisation', control: 'text', section: 'attributes' },
    { key: 'data.location', label: 'Location', control: 'text', section: 'attributes' },
    { key: 'data.notes', label: 'Notes', control: 'textarea', section: 'content' },
  ],
  identityKeys: (node) => {
    const keys: string[] = [];
    for (const email of node.data.emails) {
      const value = email.trim().toLowerCase();
      if (value !== '') keys.push(`email:${value}`);
    }
    for (const username of node.data.usernames) {
      const value = username.trim().toLowerCase().replace(/^@/, '');
      if (value !== '') keys.push(`username:${value}`);
    }
    return keys;
  },
  searchFields: (node) => ({
    title: clean(node.title !== '' ? node.title : node.data.displayName, 300),
    body: clean(node.data.notes, 4000),
    keywords: keywords(
      ...node.data.usernames,
      ...node.data.emails,
      node.data.organization,
      node.data.location,
    ),
  }),
  validate: (node) =>
    node.data.emails
      .filter((email) => email.trim() !== '' && !EMAIL_RE.test(email.trim()))
      .map((email) => ({
        code: 'EMAIL_MALFORMED',
        field: 'data.emails',
        severity: 'warning' as const,
        message: `"${email}" does not look like an email address. Keep it if it is a raw observation, otherwise correct it.`,
      })),
  capture: {
    match: (input) => (input.kind === 'text' && EMAIL_RE.test((input.text ?? '').trim()) ? 0.9 : 0),
    build: (input) => {
      const email = (input.text ?? '').trim();
      return { title: email, data: { displayName: email, emails: [email] } };
    },
  },
  io: {
    ...jsonIo(PersonDataSchema),
    toMarkdown: (node) => {
      const handles = node.data.usernames.map((u) => `\`${u}\``).join(', ');
      return `**${node.data.displayName === '' ? node.title : node.data.displayName}**${handles === '' ? '' : `\n\n${handles}`}`;
    },
  },
});
