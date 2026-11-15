# Schema deployment

Ordinary restarts run the server without Prisma schema writes. An intentional schema change requires a consistent backup and read-only migration diff review. RECALL_APPLY_SCHEMA=1 enables non-destructive prisma db push; destructive-operation refusal is intentional. Never add --accept-data-loss to startup. The push step first runs scripts/drop-fts.cjs, which drops the derived bookmark_fts table and its shadow tables: Prisma otherwise refuses (data-loss warning) or, with --accept-data-loss, crashes on the cascaded shadow tables (recall-jry). initFts() rebuilds the index on first search. scripts/check-boot-schema.ts proves both halves against a real push.

The 2026-09-10 Next.js16.3.3 patch had byte-identical Prisma schemas and used command: [node, server.js]. No migration or FTS deletion was executed.
