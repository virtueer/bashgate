/**
 * Bashgate - Bash Command Gatekeeper Extension
 *
 * Plays bell sound and shows notifications on every bash command and when LLM response ends.
 * Checks each split part for safety. Unsafe parts trigger approval.
 * Opens a single editor to edit the command and add an LLM note.
 *
 * Usage:
 *   pi -e .pi/bashgate/bashgate.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Paths ──────────────────────────────────────────────────────────────────
const extDir = __dirname;
const globalConfigPath = resolve(extDir, "bashgate-config.json");
const localSafePath = resolve(process.cwd(), ".pi", "bashgate", "bashgate-local.jsonl");

// ── Load global config ─────────────────────────────────────────────────────
let config: { safeCommands: string[]; safePatterns: string[]; unsafePatterns: string[] };
try {
  config = JSON.parse(readFileSync(globalConfigPath, "utf8"));
} catch {
  config = { safeCommands: [], safePatterns: [], unsafePatterns: [] };
}
const safeRegexes = config.safePatterns.map(p => new RegExp(p, "i"));
const unsafeRegexes = config.unsafePatterns.map(p => new RegExp(p, "i"));

// ── Load project-local safe commands ───────────────────────────────────────
const localSafeCommands: string[] = [];
if (existsSync(localSafePath)) {
  try {
    const lines = readFileSync(localSafePath, "utf8").trim().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) localSafeCommands.push(trimmed);
    }
  } catch { /* ignore */ }
}

// ── Check if a single part is safe ─────────────────────────────────────────
function checkPartSafe(part: string): { safe: boolean; reason?: string } {
  const trimmed = part.trim();
  if (!trimmed) return { safe: true };

  // Check unsafe patterns first
  for (const re of unsafeRegexes) {
    if (re.test(trimmed)) {
      return { safe: false, reason: `matched unsafe pattern: ${re.source}` };
    }
  }

  // Check safe commands list (exact first-word match)
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  for (const cmd of config.safeCommands) {
    if (firstWord === cmd.toLowerCase()) return { safe: true };
  }

  // Check local safe list (literal substring match)
  for (const p of localSafeCommands) {
    if (trimmed.toLowerCase().includes(p.toLowerCase())) return { safe: true };
  }

  // Check safe patterns
  for (const re of safeRegexes) {
    if (re.test(trimmed)) return { safe: true };
  }

  return { safe: false, reason: `not in safe commands list` };
}

// ── Split for safety checking (&&, ||, ; only — keeps pipelines together) ─
function splitSafetyParts(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < cmd.length) {
    const ch = cmd[i];

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      current += ch;
      i++;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
      current += ch;
      i++;
      continue;
    }

    if (ch === "'") { inSingleQuote = true; current += ch; i++; continue; }
    if (ch === '"') { inDoubleQuote = true; current += ch; i++; continue; }
    if (ch === '#') {
      current += ch;
      i++;
      while (i < cmd.length && cmd[i] !== '\n') { current += cmd[i]; i++; }
      continue;
    }

    // Only split on &&, ||, ; — NOT on |
    if (ch === ';' || (ch === '&' && cmd[i + 1] === '&') || (ch === '|' && cmd[i + 1] === '|')) {
      const part = current.trim();
      if (part) parts.push(part);
      current = "";
      if (ch === '&') i += 2;
      else if (ch === '|') i += 2;
      else i++;
      continue;
    }

    current += ch;
    i++;
  }

  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

// ── Split command into logical parts (&&, ||, ;, |) respecting quotes ──────
function splitCommandParts(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < cmd.length) {
    const ch = cmd[i];

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      current += ch;
      i++;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
      current += ch;
      i++;
      continue;
    }

    if (ch === "'") { inSingleQuote = true; current += ch; i++; continue; }
    if (ch === '"') { inDoubleQuote = true; current += ch; i++; continue; }
    if (ch === '#') {
      current += ch;
      i++;
      while (i < cmd.length && cmd[i] !== '\n') { current += cmd[i]; i++; }
      continue;
    }

    if (ch === ';' || (ch === '&' && cmd[i + 1] === '&') || (ch === '|') || (ch === '|' && cmd[i + 1] === '|')) {
      const part = current.trim();
      if (part) parts.push(part);
      current = "";
      if (ch === '&') i += 2;
      else if (ch === '|' && cmd[i + 1] === '|') i += 2;
      else i++;
      continue;
    }

    current += ch;
    i++;
  }

  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

// ── Rejoin parts with their operators ──────────────────────────────────────
function joinCommandParts(parts: string[], original: string): string {
  // Extract operators from original command
  const opRegex = /\s*(;|&&|\|\||\|)\s*/g;
  const operators: string[] = [];
  let match;
  while ((match = opRegex.exec(original)) !== null) {
    operators.push(match[1]);
  }

  return parts.reduce((acc, part, i) => {
    if (i === 0) return part;
    const op = operators[i - 1] || " ";
    return acc + " " + op + " " + part;
  }, "");
}

// ── Format command with parts on separate lines ────────────────────────────
function formatCommandForEditor(cmd: string): string {
  const parts = splitCommandParts(cmd);
  const opRegex = /\s*(;|&&|\|\||\|)\s*/g;
  const operators: string[] = [];
  let match;
  while ((match = opRegex.exec(cmd)) !== null) {
    operators.push(match[1]);
  }

  const lines: string[] = [];
  parts.forEach((part, i) => {
    if (i === 0) {
      lines.push(part);
    } else {
      const op = operators[i - 1] || " ";
      lines.push(op + " " + part);
    }
  });
  return lines.join("\n");
}

// ── Main extension ─────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  const overrideData = new Map<string, { originalCommand: string; newCommand?: string; note?: string }>();

  // Bell + notify on every bash command
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!ctx.hasUI) return;
    playBell();
    ctx.ui.setStatus("bashgate", "⚙️  Running: " + truncate(event.input.command, 40));
  });

  // Bell + notify when LLM response ends
  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    playBell();
    ctx.ui.setStatus("bashgate", "✅ Done");
    setTimeout(() => ctx.ui.setStatus("bashgate", ""), 3000);
  });

  // Editor hook — edit command + add LLM note
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (!command) return;
    if (!ctx.hasUI) return;

    // Check each part for safety (keep pipelines together)
    const parts = splitSafetyParts(command);
    const unsafeParts: { part: string; reason: string }[] = [];
    for (const part of parts) {
      const result = checkPartSafe(part);
      if (!result.safe && result.reason) {
        unsafeParts.push({ part, reason: result.reason });
      }
    }

    // If all parts are safe, run directly (no dialog)
    if (unsafeParts.length === 0) {
      return;
    }

    // Unsafe parts found — show approval dialog
    try {
      const unsafeList = unsafeParts.map((u, i) => `${i + 1}. \`${truncate(u.part, 60)}\` — ${u.reason}`).join("\n");
      const dialogMsg = `🔒 Unsafe command detected\n\n⚠️ ${unsafeParts.length} unsafe part(s):\n${unsafeList}\n\nCommand: \`${truncate(command, 100)}\``;

      const choice = await ctx.ui.select(
        dialogMsg,
        ["✓  Proceed with approval", "✗  Block"],
        { signal: ctx.signal }
      );

      if (!choice || choice === "✗  Block") {
        return { block: true, reason: "Unsafe command blocked" };
      }
    } catch (err) {
      return { block: true, reason: err instanceof Error ? err.message : "Approval error" };
    }

    // Open editor for unsafe commands
    try {
      const formatted = formatCommandForEditor(command);

      const editorText = await ctx.ui.editor(
        "Edit command & add note",
        `${formatted}\n\n# Note for LLM: `,
      );
      if (!editorText) {
        return { block: true, reason: "Editor cancelled" };
      }

      // Parse editor output: first section is the command, after "# Note for LLM:" is the note
      const noteMarker = "# Note for LLM:";
      const noteIdx = editorText.indexOf(noteMarker);
      let commandText: string;
      let note: string;

      if (noteIdx >= 0) {
        commandText = editorText.slice(0, noteIdx).trim();
        const notePart = editorText.slice(noteIdx + noteMarker.length).trim();
        note = notePart.replace(/^#\s*/, "");
      } else {
        commandText = editorText.trim();
        note = "";
      }

      // Rejoin command parts using the same parser
      const newCommand = joinCommandParts(splitCommandParts(commandText), command);

      if (!newCommand) {
        return { block: true, reason: "Empty command" };
      }

      overrideData.set(event.toolCallId, { originalCommand: command, newCommand, note: note || undefined });
      event.input.command = newCommand;
    } catch (err) {
      return { block: true, reason: err instanceof Error ? err.message : "Editor error" };
    }

    return;
  });

  // After bash execution — notify LLM of overrides
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const data = overrideData.get(event.toolCallId);
    if (!data || !data.note) {
      overrideData.delete(event.toolCallId);
      return;
    }

    const stdout = Array.isArray(event.content)
      ? event.content.filter((c) => c.type === "text").map((c) => c.text).join("\n")
      : "";

    const lines: string[] = [];
    lines.push(`🔧 **Bash command modified**`);
    lines.push(`Original: \`${data.originalCommand}\``);
    if (data.newCommand) lines.push(`Modified: \`${data.newCommand}\``);
    if (stdout) lines.push(`\n**Output:**\n\`${truncate(stdout, 500)}\``);
    lines.push(`\n**Note:** ${data.note}`);

    pi.sendMessage(
      {
        customType: "bash-override",
        content: lines.join("\n"),
        display: true,
      },
      { deliverAs: "followUp" }
    );

    overrideData.delete(event.toolCallId);
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function playBell(): void {
  process.stderr.write("\x07");
}
