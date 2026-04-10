import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const CardNewsStatSchema = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(40),
  tone: z.enum(["accent", "info", "danger", "muted"]).optional(),
});

export const CardNewsSlideSchema = z.object({
  pageLabel: z.string().trim().max(30).optional(),
  eyebrow: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(120),
  accentTitle: z.string().trim().max(120).optional(),
  subtitle: z.string().trim().max(160).optional(),
  body: z.string().trim().max(1500).optional(),
  quote: z.string().trim().max(240).optional(),
  footer: z.string().trim().max(180).optional(),
  stats: z.array(CardNewsStatSchema).max(6).optional(),
});

export const CardNewsProjectWriteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(40).optional(),
  templateKey: z.string().trim().min(1).max(80),
  backgroundImageUrl: z.string().trim().url().optional().nullable(),
  slides: z.array(CardNewsSlideSchema).min(1).max(10),
});

export type CardNewsProjectWriteInput = z.infer<typeof CardNewsProjectWriteSchema>;

function toStatsJson(stats?: z.infer<typeof CardNewsStatSchema>[]) {
  if (!stats || stats.length === 0) return undefined;
  return stats as Prisma.InputJsonValue;
}

function fromStatsJson(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function projectSelect() {
  return {
    id: true,
    title: true,
    brand: true,
    templateKey: true,
    backgroundImageUrl: true,
    createdAt: true,
    updatedAt: true,
    slides: {
      orderBy: { orderIndex: "asc" as const },
      select: {
        id: true,
        orderIndex: true,
        pageLabel: true,
        eyebrow: true,
        title: true,
        accentTitle: true,
        subtitle: true,
        body: true,
        quote: true,
        footer: true,
        statsJson: true,
        createdAt: true,
        updatedAt: true,
      },
    },
  };
}

type CardNewsProjectRecord = Awaited<ReturnType<typeof getCardNewsProjectRecord>>;

async function getCardNewsProjectRecord(id: string, userId: string) {
  return prisma.cardNewsProject.findFirst({
    where: { id, userId },
    select: projectSelect(),
  });
}

export function serializeCardNewsProject(project: NonNullable<CardNewsProjectRecord>) {
  return {
    id: project.id,
    title: project.title,
    brand: project.brand,
    templateKey: project.templateKey,
    backgroundImageUrl: project.backgroundImageUrl,
    slideCount: project.slides.length,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    slides: project.slides.map((slide) => ({
      id: slide.id,
      orderIndex: slide.orderIndex,
      pageLabel: slide.pageLabel,
      eyebrow: slide.eyebrow,
      title: slide.title,
      accentTitle: slide.accentTitle,
      subtitle: slide.subtitle,
      body: slide.body,
      quote: slide.quote,
      footer: slide.footer,
      stats: fromStatsJson(slide.statsJson),
      createdAt: slide.createdAt.toISOString(),
      updatedAt: slide.updatedAt.toISOString(),
    })),
  };
}

function nestedSlidesCreate(slides: CardNewsProjectWriteInput["slides"]) {
  return slides.map((slide, index) => ({
    orderIndex: index,
    pageLabel: slide.pageLabel,
    eyebrow: slide.eyebrow,
    title: slide.title,
    accentTitle: slide.accentTitle,
    subtitle: slide.subtitle,
    body: slide.body,
    quote: slide.quote,
    footer: slide.footer,
    statsJson: toStatsJson(slide.stats),
  }));
}

export async function listCardNewsProjects(userId: string) {
  const projects = await prisma.cardNewsProject.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }],
    select: projectSelect(),
  });

  return projects.map(serializeCardNewsProject);
}

export async function getCardNewsProject(id: string, userId: string) {
  const project = await getCardNewsProjectRecord(id, userId);
  if (!project) return null;
  return serializeCardNewsProject(project);
}

export async function createCardNewsProject(userId: string, input: CardNewsProjectWriteInput) {
  const project = await prisma.cardNewsProject.create({
    data: {
      userId,
      title: input.title,
      brand: input.brand,
      templateKey: input.templateKey,
      backgroundImageUrl: input.backgroundImageUrl,
      slides: {
        create: nestedSlidesCreate(input.slides),
      },
    },
    select: projectSelect(),
  });

  return serializeCardNewsProject(project);
}

export async function updateCardNewsProject(id: string, userId: string, input: CardNewsProjectWriteInput) {
  const existing = await prisma.cardNewsProject.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return null;

  const project = await prisma.cardNewsProject.update({
    where: { id: existing.id },
    data: {
      title: input.title,
      brand: input.brand,
      templateKey: input.templateKey,
      backgroundImageUrl: input.backgroundImageUrl,
      slides: {
        deleteMany: {},
        create: nestedSlidesCreate(input.slides),
      },
    },
    select: projectSelect(),
  });

  return serializeCardNewsProject(project);
}

export async function deleteCardNewsProject(id: string, userId: string) {
  return prisma.cardNewsProject.deleteMany({
    where: { id, userId },
  });
}
