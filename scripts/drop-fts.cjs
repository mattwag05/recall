// Drop the derived bookmark_fts index (and its shadow tables) before a reviewed
// schema push. Prisma cannot model FTS5 tables: it plans a DropTable for each
// shadow table, errors once the virtual-table drop cascades them away, and
// otherwise refuses without --accept-data-loss. initFts() rebuilds the index
// from Bookmark on first use, so nothing is lost.
const Database = require('better-sqlite3')
const db = new Database(process.env.DATABASE_PATH || '/data/recall.db')
db.exec('DROP TABLE IF EXISTS bookmark_fts')
db.close()
