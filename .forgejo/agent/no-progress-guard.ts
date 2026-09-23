import { createHash } from "node:crypto";

// Guide the agent once, then stop an unchanged bash command from looping.
// Keep only in-memory fingerprints for the current agent run, never tool content.
export default function noProgressGuard(pi) {
  const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
  let lastCommand = null;
  let lastResult = null;
  let unchangedResults = 0;
  let softBlocked = false;

  const reset = () => {
    lastCommand = null;
    lastResult = null;
    unchangedResults = 0;
    softBlocked = false;
  };
  pi.on("session_start", reset);
  pi.on("agent_start", reset);

  pi.on("tool_call", (event, context) => {
    if (event.toolName !== "bash") return reset();
    const command = event.input?.command;
    if (typeof command !== "string") return reset();
    const commandHash = fingerprint(command);
    if (lastCommand !== null && commandHash !== lastCommand) reset();
    if (commandHash === lastCommand && unchangedResults >= 2) {
      if (!softBlocked) {
        softBlocked = true;
        return {
          block: true,
          reason: "No new result from this exact bash command after two runs. Do not rerun it unchanged. Compare the exact inputs and state with the code's accepted conditions, then inspect or test a narrower change. If you cannot identify new evidence, explain the blocker. This duplicate call was blocked without running.",
        };
      }
      // Older Pi releases ignore `terminate`; abort is supported on all hosts.
      context.abort();
      return {
        block: true,
        terminate: true,
        reason: "This command already produced the same unchanged result twice and was retried after guidance. Stop this run and explain the blocker without retrying it.",
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
    if (commandHash !== lastCommand || result !== lastResult) softBlocked = false;
    unchangedResults = commandHash === lastCommand && result === lastResult
      ? unchangedResults + 1 : 1;
    lastCommand = commandHash;
    lastResult = result;
  });
}
