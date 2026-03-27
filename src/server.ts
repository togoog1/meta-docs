import "dotenv/config";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { DocPageType } from "./generated/prisma/client.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { initializeDatabaseSchema } from "./lib/init-db.js";
import { prisma } from "./lib/prisma.js";
import {
  getDocPageDetail,
  getDocsOverview,
  getDocSnapshot,
  listDocPages
} from "./services/docs/queries.js";
import { syncMetaGraphDocs } from "./services/docs/sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const clientDistPath = path.join(projectRoot, "web", "dist");

const docPageTypeSchema = z.enum([
  DocPageType.REFERENCE_INDEX,
  DocPageType.REFERENCE_ITEM,
  DocPageType.GUIDE,
  DocPageType.CHANGELOG,
  DocPageType.CHANGELOG_VERSION,
  DocPageType.UNKNOWN
]);

function normalizeError(error: unknown): { statusCode: number; message: string } {
  if (error instanceof z.ZodError) {
    return {
      statusCode: 400,
      message: error.issues.map((issue) => issue.message).join("; ")
    };
  }
  if (error instanceof Error) {
    const statusCode = error.message.includes("not found") ? 404 : 500;
    return {
      statusCode,
      message: error.message
    };
  }

  return {
    statusCode: 500,
    message: "Unknown server error"
  };
}

async function buildServer() {
  const app = Fastify({
    logger: true,
    disableRequestLogging: true
  });

  await app.register(cors, {
    origin: true
  });

  app.get("/api/health", async () => ({
    ok: true
  }));

  app.get("/api/docs/overview", async (_request, reply) => {
    try {
      return await getDocsOverview();
    } catch (error) {
      const normalized = normalizeError(error);
      return reply.status(normalized.statusCode).send({
        error: normalized.message
      });
    }
  });

  app.get("/api/docs/pages", async (request, reply) => {
    try {
      const query = request.query as {
        q?: string;
        pageType?: string;
        limit?: string;
      };
      const limit = Number.parseInt(String(query.limit ?? "200"), 10);
      return await listDocPages({
        query: query.q,
        pageType: query.pageType ? docPageTypeSchema.parse(query.pageType) : undefined,
        limit: Number.isNaN(limit) ? 200 : limit
      });
    } catch (error) {
      const normalized = normalizeError(error);
      return reply.status(normalized.statusCode).send({
        error: normalized.message
      });
    }
  });

  app.get("/api/docs/pages/:pageId", async (request, reply) => {
    try {
      const { pageId } = request.params as { pageId: string };
      return await getDocPageDetail(pageId);
    } catch (error) {
      const normalized = normalizeError(error);
      return reply.status(normalized.statusCode).send({
        error: normalized.message
      });
    }
  });

  app.get("/api/docs/snapshots/:snapshotId", async (request, reply) => {
    try {
      const { snapshotId } = request.params as { snapshotId: string };
      return await getDocSnapshot(snapshotId);
    } catch (error) {
      const normalized = normalizeError(error);
      return reply.status(normalized.statusCode).send({
        error: normalized.message
      });
    }
  });

  app.post("/api/docs/sync", async (request, reply) => {
    try {
      const body = z
        .object({
          maxPages: z.number().int().positive().max(300).default(40)
        })
        .parse(request.body ?? {});

      const run = await syncMetaGraphDocs({
        maxPages: body.maxPages,
        trigger: "api",
        requestedBy: "dashboard"
      });

      return reply.status(201).send(run);
    } catch (error) {
      const normalized = normalizeError(error);
      return reply.status(normalized.statusCode).send({
        error: normalized.message
      });
    }
  });

  if (existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: path.join(clientDistPath, "assets"),
      prefix: "/assets/"
    });

    app.get("/", async (_request, reply) => {
      const html = await readFile(path.join(clientDistPath, "index.html"), "utf8");
      return reply.type("text/html").send(html);
    });

    app.get("/*", async (_request, reply) => {
      const html = await readFile(path.join(clientDistPath, "index.html"), "utf8");
      return reply.type("text/html").send(html);
    });
  }

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}

await initializeDatabaseSchema();
const app = await buildServer();
const port = Number.parseInt(process.env.PORT ?? "3002", 10);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({
  port,
  host
});
