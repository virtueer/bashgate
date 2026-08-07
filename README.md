# Bashgate — Bash Command Gatekeeper Extension

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that intercepts bash commands, checks them for safety, and provides an editor for modification with LLM notes.

## Features

- **Bell + status notifications** on every bash command + when LLM response ends
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
    └── bashgate/
        ├── index.ts             # export { default } from "./bashgate"
        ├── bashgate.ts          # main extension code
        ├── bashgate-config.json # safe/unsafe patterns
        └── bashgate-local.jsonl # project-local safe commands
```

### 2. Set up auto-discovery (global install)

Create a symlink so pi auto-discovers the extension:

```bash
ln -s /path/to/your-project/.pi/bashgate ~/.pi/agent/extensions/bashgate
```

### 3. Install dependencies

```bash
cd .pi/bashgate
npm install
```

## Configuration

### `bashgate-config.json`

```json
{
  "safeCommands": ["cd", "ls", "grep", "cat", "find", "rm", "mkdir", ...],
  "safePatterns": [
    "^\\s*(echo|printf)\\s+.*$",
    "^\\s*(ls|ll|la)\\s+.*$",
    "^\\s*(pwd|cd)\\s*(\\..*|/\\S*|\\S*)?\\s*$",
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

- **`safeCommands`**: List of safe command names (exact first-word match)
- **`safePatterns`**: Regex patterns for safe command variants
- **`unsafePatterns`**: Regex patterns that always trigger approval

### `bashgate-local.jsonl`

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
ls -la .pi/bashgate | grep -E ".(ts|json)" && cat config.json | head -10

# Split into 2 parts (by &&):
  1. ls -la .pi/bashgate | grep -E ".(ts|json)"   (pipeline — kept together)
  2. cat config.json | head -10                    (pipeline — kept together)
```

Pipelines (`|`) are kept together for safety checking but displayed on separate lines in the editor.

## Security Model

- **Default deny**: Unknown commands require approval
- **Global config is read-only**: Never modified by approvals
- **Per-project trust**: Safe commands saved project-locally
- **Pipeline awareness**: `curl | bash` checked as one unit, not separate commands

## Dependencies

- `@earendil-works/pi-coding-agent` — pi extension API

## License

MIT
