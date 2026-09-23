import { createHash } from "node:crypto";

// Stop a successful or failed bash command from repeating unchanged indefinitely.
// Keep only in-memory fingerprints for the current agent run, never tool content.
export default function noProgressGuard(pi) {
  const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
  let lastCommand = null;
  let lastResult = null;
  let unchangedResults = 0;

  const reset = () => {
    lastCommand = null;
    lastResult = null;
    unchangedResults = 0;
  };
  pi.on("session_start", reset);
  pi.on("agent_start", reset);

  pi.on("tool_call", (event, context) => {
    if (event.toolName !== "bash") return;
    const command = event.input?.command;
    if (typeof command !== "string") return;
    if (fingerprint(command) === lastCommand && unchangedResults >= 2) {
      // Older Pi releases ignore `terminate`; abort is supported on all hosts.
      context.abort();
      return {
        block: true,
        terminate: true,
        reason: "This command already produced the same unchanged result twice. Stop this run, explain the blocker, and choose a different approach only after new user input.",
      };
    }
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash") return reset();
    const command = event.input?.command;
    if (typeof command !== "string") return reset();
    const text = event.content?.filter((part) => part.type === "text").map((part) => part.text) ?? [];
    if (!text.length) return reset();
    const result = fingerprint(JSON.stringify({
      error: event.isError,
      text,
    }));
    const commandHash = fingerprint(command);
    unchangedResults = commandHash === lastCommand && result === lastResult
      ? unchangedResults + 1 : 1;
    lastCommand = commandHash;
    lastResult = result;
  });
}
