/**
 * Error-leak regression test.
 *
 * Verifies that no API route responses leak internal error details via
 * the raw-error-interpolation pattern. Scans the app/api directory for any
 * occurrence that would flow a caught error into a response body.
 *
 * Pure check script, no DB, no server, no AI. Safe to run via npm test.
 */
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let passed = 0
let failed = 0

function reportOk(name: string) {
  passed++
  console.log("PASS: " + name)
}

function reportFail(name: string, reason: string) {
  failed++
  console.error("FAIL: " + name)
  console.error(reason)
}

// Write the leak pattern to a temp file so grep -f can read it without
// shell parsing issues with parentheses.
const leakPatternFile = join(tmpdir(), "recall-leak-pattern-" + Date.now() + ".txt")
writeFileSync(leakPatternFile, "String(err)\n")

const grep1 = "grep -rn -f " + leakPatternFile + " app/api/ --include=route.ts"

try {
  execSync(grep1, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
  reportFail(
    "no String(err) in app/api route.ts response bodies",
    "grep found matches for String(err) in API routes — error details are leaking.",
  )
} catch (e) {
  const status = (e as { status?: number }).status
  if (status === 1) {
    reportOk("no String(err) in app/api route.ts response bodies")
  } else {
    throw e
  }
}

// Clean up the temp pattern file.
try { unlinkSync(leakPatternFile) } catch {}

// For the instanceof Error check, the pattern has no special shell chars.
const grep2 = 'grep -rn "instanceof Error" app/api/ --include=route.ts'

try {
  execSync(grep2, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
  reportFail(
    "no broad instanceof Error guard in per-item failure arrays",
    "grep found instanceof Error in API routes — broad guard still leaking.",
  )
} catch (e) {
  const status = (e as { status?: number }).status
  if (status === 1) {
    reportOk("no broad instanceof Error guard in per-item failure arrays")
  } else {
    throw e
  }
}

console.log("")
console.log("Error-leak check: " + passed + " passed, " + failed + " failed")
if (failed) process.exit(1)
else process.exit(0)
