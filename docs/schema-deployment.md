# Schema deployment

Ordinary restarts run the server without Prisma schema writes. An intentional schema change requires a consistent backup and read-only migration diff review. RECALL_APPLY_SCHEMA=1 enables non-destructive prisma db push; destructive-operation refusal is intentional. Never add --accept-data-loss to startup. Derived FTS tables need explicit handling in a reviewed schema migration.

The 2026-09-10 Next.js16.3.3 patch had byte-identical Prisma schemas and used command: [node, server.js]. No migration or FTS deletion was executed.
