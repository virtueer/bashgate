# Virtuex — Bash Command Editor Extension

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that intercepts bash commands, checks them for safety, and provides an editor for modification with LLM notes.

## Features

- **Bell sound** on every bash command
- **Safety checking** — splits commands by operators (`&&`, `||`, `;`) and checks each part
- **Auto-approve safe commands** — runs directly without any dialog
- **Approval dialog** for unsafe commands — shows all unsafe parts with reasons
- **Single editor** — edit command parts and add LLM notes in one step
- **LLM notification** — after execution, LLM receives original command, modified command, output, and note
- **Default deny** — unknown commands require approval (secure by default)

## Installation

### 1. Install the extension

Place the extension in your project:

```
your-project/
└── .pi/
    └── extensions/
        ├── index.ts          # export { default } from "./virtuex"
        ├── virtuex.ts        # main extension code
        ├── virtuex-config.json # safe/unsafe patterns
        └── virtuex-local.jsonl # project-local safe commands
```

### 2. Set up auto-discovery (global install)

Create a symlink so pi auto-discovers the extension:

```bash
ln -s /path/to/your-project/.pi/extensions ~/.pi/agent/extensions/virtuex
```

### 3. Install dependencies

```bash
cd .pi/extensions
npm install
```

## Configuration

### `virtuex-config.json`

```json
{
  "safeCommands": ["ls", "grep", "cat", "find", "rm", "mkdir", ...],
  "safePatterns": [
    "^\\s*(echo|printf)\\s+.*$",
    "^\\s*(ls|ll|la)\\s+.*$",
    "^\\s*(git)\\s+(status|log|diff|show)\\s+.*$",
    ...
  ],
  "unsafePatterns": [
    "sudo",
    "su\\b",
    "rm\\s+(-rf?|--recursive|--force)",
    "chmod\\s+777",
    "curl\\s+.*\\|\\s*(sh|bash)",
    "wget\\s+.*\\|\\s*(sh|bash)",
    "eval",
    ...
  ]
}
```

- **`safeCommands`**: List of safe command names (exact match)
- **`safePatterns`**: Regex patterns for safe command variants
- **`unsafePatterns`**: Regex patterns that always trigger approval

### `virtuex-local.jsonl`

Project-local safe commands, auto-updated when you approve unsafe commands:

```
# One command per line
npm run build
git push origin main
```

## How It Works

### Safety Check Flow

```
bash command received
    │
    ├─ Split by operators (&&, ||, ;) — pipelines kept together
    │
    ├─ Check each part:
    │   ├─ Matches unsafe pattern? → UNSAFE
    │   ├─ Matches safe pattern/list? → SAFE
    │   └─ Nothing matched? → UNSAFE (default deny)
    │
    ├─ All parts safe? → Run directly (bell only)
    │
    └─ Any part unsafe? → Approval dialog
                          │
                          ├─ Block → command blocked
                          └─ Approve → Editor opens
                                        │
                                        ├─ Edit command + add LLM note
                                        └─ Execute → LLM notified
```

### Command Splitting

Commands are split by shell operators while respecting quotes:

```bash
# Input:
ls -la .pi/extensions | grep -E ".(ts|json)" && cat config.json | head -10

# Split into 2 parts (by &&):
  1. ls -la .pi/extensions | grep -E ".(ts|json)"   (pipeline — kept together)
  2. cat config.json | head -10                      (pipeline — kept together)
```

Pipelines (`|`) are kept together for safety checking but displayed on separate lines in the editor.

## Security Model

- **Default deny**: Unknown commands require approval
- **Global config is read-only**: Never modified by approvals
- **Per-project trust**: Safe commands saved project-locally
- **Pipeline awareness**: `curl | bash` checked as one unit, not separate commands

## Dependencies

- `@earendil-works/pi-coding-agent` — pi extension API
- `bash-parser` — AST analysis of bash commands

## License

MIT
