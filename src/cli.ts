import "dotenv/config";

import { Command } from "commander";

import { initializeDatabaseSchema } from "./lib/init-db.js";
import { prisma } from "./lib/prisma.js";
import { getDocsOverview } from "./services/docs/queries.js";
import { syncMetaGraphDocs } from "./services/docs/sync.js";

function parseInteger(rawValue: string, label: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

const program = new Command();

program.name("meta-docs").description("Local Meta Graph docs crawler");

program
  .command("init-db")
  .description("Create the local SQLite schema used by the docs crawler")
  .action(async () => {
    await initializeDatabaseSchema();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });

program
  .command("sync-meta-docs")
  .description("Crawl and snapshot Meta Graph API docs into the local SQLite store")
  .option("--max-pages <count>", "Maximum number of pages to fetch", "40")
  .action(async (options) => {
    await initializeDatabaseSchema();
    const run = await syncMetaGraphDocs({
      maxPages: parseInteger(options.maxPages, "max pages"),
      trigger: "cli",
      requestedBy: "cli"
    });
    const overview = await getDocsOverview();

    console.log(
      JSON.stringify(
        {
          run,
          counts: overview.counts
        },
        null,
        2
      )
    );
  });

program
  .command("docs-overview")
  .description("Print current docs crawler counts and recent activity")
  .action(async () => {
    await initializeDatabaseSchema();
    const overview = await getDocsOverview();
    console.log(JSON.stringify(overview, null, 2));
  });

try {
  await program.parseAsync(process.argv);
} finally {
  await prisma.$disconnect();
}
