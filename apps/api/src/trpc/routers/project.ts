import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import { isId, newId, systemClock } from '@nexus/domain';
import { orgProcedure, router } from '../trpc.ts';
import { audit } from '../../audit.ts';

export const Id = z.string().refine(isId, 'Not a valid id');

interface ProjectRow {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (p: ProjectRow) => ({
  id: p.id,
  orgId: p.orgId,
  key: p.key,
  name: p.name,
  description: p.description,
  color: p.color,
  icon: p.icon,
  archivedAt: p.archivedAt,
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

/** A live (not soft-deleted) project of the caller's org, or a user-facing not-found error. */
async function requireProject(projectId: string, orgId: string): Promise<ProjectRow> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId, deletedAt: null },
  });
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That project no longer exists.' });
  }
  return project;
}

export const projectRouter = router({
  list: orgProcedure('viewer')
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          includeArchived: z.boolean().default(false),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const projects = await prisma.project.findMany({
        where: {
          orgId: ctx.org.id,
          deletedAt: null,
          ...(input.includeArchived ? {} : { archivedAt: null }),
        },
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
        color: z.string().max(40).optional(),
        icon: z.string().max(32).optional(),
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
          color: input.color ?? null,
          icon: input.icon ?? null,
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

  rename: orgProcedure('editor')
    .input(z.object({ projectId: Id, name: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await requireProject(input.projectId, ctx.org.id);
      const project = await prisma.project.update({
        where: { id: input.projectId },
        data: { name: input.name },
      });
      await audit(
        {
          action: 'project.renamed',
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

  setAppearance: orgProcedure('editor')
    .input(
      z.object({
        projectId: Id,
        color: z.string().max(40).nullable().optional(),
        icon: z.string().max(32).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProject(input.projectId, ctx.org.id);
      const project = await prisma.project.update({
        where: { id: input.projectId },
        data: {
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
        },
      });
      await audit(
        {
          action: 'project.appearance_changed',
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

  archive: orgProcedure('editor')
    .input(z.object({ projectId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireProject(input.projectId, ctx.org.id);
      const project = await prisma.project.update({
        where: { id: input.projectId },
        data: { archivedAt: systemClock.now() },
      });
      await audit(
        {
          action: 'project.archived',
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

  restore: orgProcedure('editor')
    .input(z.object({ projectId: Id }))
    .mutation(async ({ ctx, input }) => {
      await requireProject(input.projectId, ctx.org.id);
      const project = await prisma.project.update({
        where: { id: input.projectId },
        data: { archivedAt: null },
      });
      await audit(
        {
          action: 'project.restored',
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
      const project = await requireProject(input.projectId, ctx.org.id);
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
