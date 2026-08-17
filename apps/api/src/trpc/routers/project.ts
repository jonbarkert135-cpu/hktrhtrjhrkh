import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { isId, newId, systemClock } from '@nexus/domain';
import { orgProcedure, router } from '../trpc.js';
import { audit } from '../../audit.js';

export const Id = z.string().refine(isId, 'Not a valid id');

interface ProjectRow {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (p: ProjectRow) => ({
  id: p.id,
  orgId: p.orgId,
  key: p.key,
  name: p.name,
  description: p.description,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/**
 * `projects.key` is unique per org and user-visible (it prefixes board urls later).
 * ponytail: derived from the name plus a short random suffix instead of a retry loop, which is
 * collision-safe enough at 36^4 per name. Upgrade path: a real "next free key" query in P7 when
 * keys become user-editable.
 */
function projectKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base === '' ? 'project' : base}-${suffix}`;
}

export const projectRouter = router({
  list: orgProcedure('viewer')
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).default({}))
    .query(async ({ ctx, input }) => {
      const projects = await prisma.project.findMany({
        where: { orgId: ctx.org.id, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
      });
      return projects.map(toDto);
    }),

  create: orgProcedure('editor')
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.create({
        data: {
          id: newId.project(),
          orgId: ctx.org.id,
          key: projectKey(input.name),
          name: input.name,
          description: input.description ?? null,
          createdBy: ctx.user.id,
        },
      });
      await audit(
        {
          action: 'project.created',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'project',
          targetId: project.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return toDto(project);
    }),

  delete: orgProcedure('admin')
    // N8: destructive actions are confirmed — the caller must retype the project name.
    .input(z.object({ projectId: Id, confirmName: z.string().max(120) }))
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, orgId: ctx.org.id, deletedAt: null },
      });
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That project no longer exists.' });
      }
      if (project.name !== input.confirmName) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The name you typed does not match the project name.',
        });
      }
      // Soft delete: the row is purged by the maintenance job after the undo window.
      await prisma.project.update({
        where: { id: project.id },
        data: { deletedAt: systemClock.now() },
      });
      await audit(
        {
          action: 'project.deleted',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'project',
          targetId: project.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return { ok: true as const };
    }),
});
