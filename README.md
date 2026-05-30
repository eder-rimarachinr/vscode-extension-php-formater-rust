# PHP Formatter

PHP Formatter formats your PHP files using a native Rust binary — no Node.js dependencies, no PHP runtime required.

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/local/php-formatter/releases)
[![VSCode](https://img.shields.io/badge/VSCode-1.85%2B-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
![License](https://img.shields.io/badge/license-MIT-green)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#supported-platforms)
[![Rust](https://img.shields.io/badge/powered%20by-Rust-orange?logo=rust)](https://www.rust-lang.org/)

---

## Before / After

```diff
  <?php
  
- $name = 'foo';
- $version = '1.0';
- $x = 42;
+ $name    = 'foo';
+ $version = '1.0';
+ $x       = 42;
  
  $arr = [
-     'key' => 1,
-     'longkey' => 2,
+     'key'     => 1,
+     'longkey' => 2,
  ];
  
- $data['setting']= json_encode($this->setting);
- $data['title'] = 'Dashboard';
- $data['list']= $this->model->get();
+ $data['setting'] = json_encode($this->setting);
+ $data['title']   = 'Dashboard';
+ $data['list']    = $this->model->get();
```

---

## Features

- **`=` alignment** — aligns consecutive variable assignments in the same indent block
- **`=>` alignment** — aligns fat arrows in array literals and `match` expressions
- **Inline comment alignment** — aligns `//` comments that appear on consecutive lines
- **`@fmt-off` / `@fmt-on`** — skip formatting for a region; `@formatter:off` / `@formatter:on` (PhpStorm syntax) also supported
- **Format on save** — opt-in via setting or `.phpfmt.toml`
- **Preview diff** — see what would change before applying, using VS Code's native diff editor
- **Format selection** — format only the highlighted code
- **Format workspace** — format all PHP files in the workspace in one command
- **Format folder** — right-click any folder in the Explorer to format its PHP files
- **Problems panel integration** — opt-in diagnostics showing which lines would be reformatted, with Quick Fix support
- **Per-project config** — `.phpfmt.toml` at the project root overrides all global settings
- **Status bar timing** — shows how long the last format took (e.g. `⌚ PHP fmt: 8ms`)
- **Native binary** — single self-contained executable; no PHP, no Composer, no Node.js at runtime

---

## Installation

### From the VS Code Marketplace

Search for **PHP Formatter** in the Extensions panel (`Ctrl+Shift+X`) and click **Install**.

Or from the command line:

```bash
code --install-extension local.php-formatter
```

### From a VSIX file

Download the `.vsix` from the [Releases](https://github.com/local/php-formatter/releases) page, then:

```bash
code --install-extension php-formatter-0.1.0.vsix
```

Or: Extensions panel → `···` menu → **Install from VSIX…**

> **Note:** do not open the `.vsix` by double-clicking — Windows associates that extension with Visual Studio, not VS Code.

---

## Usage

### Format document

| Action | Shortcut |
|--------|----------|
| Format current file | `Shift+Alt+F` |
| Format selection | Command Palette → `PHP Formatter: Format Selection` |
| Preview changes (diff) | Command Palette → `PHP Formatter: Preview Format` |
| Format all PHP files | Command Palette → `PHP Formatter: Format All PHP Files in Workspace` |
| Format a folder | Right-click folder in Explorer → `PHP Formatter: Format PHP Files in Folder` |

### Format on save

Enable in VS Code settings:

```jsonc
// settings.json
{
    "phpFormatter.formatOnSave": true
}
```

Or per project in `.phpfmt.toml` (takes precedence over the VS Code setting):

```toml
[on_save]
enabled = true
```

### Skip a region

```php
// @fmt-off
$matrix = [[1,0,0],[0,1,0],[0,0,1]];  // leave this untouched
// @fmt-on
```

Both `@fmt-off` / `@fmt-on` and `@formatter:off` / `@formatter:on` are recognised.

---

## Configuration

### VS Code settings

All settings live under the `phpFormatter` namespace.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `phpFormatter.binaryPath` | `string` | `""` | Absolute path to a custom `php_formatter` binary. Leave empty to use the bundled one. |
| `phpFormatter.formatOnSave` | `boolean` | `false` | Format PHP files automatically on save. |
| `phpFormatter.diagnostics` | `boolean` | `false` | Show formatting violations in the Problems panel with Quick Fix support. |

### `.phpfmt.toml` (per-project)

Place this file in the project root. Any key present here overrides the global VS Code setting for that workspace.

```toml
# .phpfmt.toml

[style]
# Number of spaces per indentation level.
indent_size = 4

[align]
# Align `=` in consecutive assignment blocks:
#   $a   = 1;
#   $foo = 2;
assignments = true

# Align `=>` in consecutive array / match lines:
#   'key'     => 1,
#   'longkey' => 2,
fat_arrows = true

# Align inline `//` comments on consecutive lines:
#   $a = 1;  // first
#   $b = 2;  // second
inline_comments = true

[on_save]
# Format automatically when the file is saved.
# Overrides the VS Code `phpFormatter.formatOnSave` setting.
enabled = false
```

---

## Examples

### Variable alignment

```php
<?php

// before
$name = 'Alice';
$age = 30;
$email = 'alice@example.com';

// after
$name  = 'Alice';
$age   = 30;
$email = 'alice@example.com';
```

### Array alignment

```php
<?php

// before
$config = [
    'host' => 'localhost',
    'port' => 3306,
    'database' => 'mydb',
    'charset' => 'utf8mb4',
];

// after
$config = [
    'host'     => 'localhost',
    'port'     => 3306,
    'database' => 'mydb',
    'charset'  => 'utf8mb4',
];
```

### Mixed block (assignments + inline comments)

```php
<?php

// before
$data['setting'] = json_encode($this->setting); // global config
$data['list'] = $this->model->get(); // rows
$data['title'] = 'Dashboard'; // page title

// after
$data['setting'] = json_encode($this->setting);  // global config
$data['list']    = $this->model->get();           // rows
$data['title']   = 'Dashboard';                   // page title
```

---

## Supported Platforms

| OS | Architecture | Status |
|----|-------------|--------|
| Windows 10 / 11 | x86-64 | ✅ Bundled |
| macOS 12+ | x86-64 | 🔧 Build from source |
| macOS 12+ | Apple Silicon (arm64) | 🔧 Build from source |
| Linux (glibc 2.17+) | x86-64 | 🔧 Build from source |

The published `.vsix` bundles the Windows x86-64 binary. For other platforms, build the binary from source (see [Contributing](#contributing)) and point `phpFormatter.binaryPath` to it.

---

## Contributing

### Requirements

- [Rust](https://rustup.rs/) (stable, 1.70+)
- [Node.js](https://nodejs.org/) 18+ and npm (for the VS Code extension)
- VS Code 1.85+

### Clone and build

```bash
git clone https://github.com/local/php-formatter.git
cd php-formatter
```

**Build the Rust binary:**

```bash
cd php-formatter        # Rust crate directory
cargo build --release
# Output: target/release/php_formatter  (or .exe on Windows)
```

**Copy the binary into the extension:**

```bash
# Windows
copy target\release\php_formatter.exe ..\vscode-extension\bin\

# macOS / Linux
cp target/release/php_formatter ../vscode-extension/bin/
```

**Build the VS Code extension:**

```bash
cd ../vscode-extension
npm install
npm run compile
npx vsce package          # produces php-formatter-x.y.z.vsix
```

### Project structure

```
php-formatter/                  Rust binary (cargo project)
├── src/
│   ├── main.rs                 Entry point — legacy + --json dispatch
│   ├── formatter.rs            Line struct, format pipeline
│   ├── config.rs               Config struct, .phpfmt.toml discovery
│   ├── protocol.rs             BinaryRequest / BinaryResponse types
│   └── rules/
│       ├── align.rs            = alignment
│       ├── align_arrows.rs     => alignment
│       ├── align_comments.rs   Inline comment alignment
│       ├── frozen.rs           @fmt-off / @fmt-on regions
│       ├── indent.rs           Indentation normalisation
│       └── spacing.rs          Operator and comma spacing
├── Cargo.toml
└── .cargo/config.toml          Linker config (uses rust-lld)

vscode-extension/               VS Code extension (TypeScript)
├── src/
│   └── extension.ts            Activation, commands, providers
├── bin/
│   └── php_formatter.exe       Bundled release binary (Windows)
├── package.json
└── tsconfig.json
```

### Running the binary directly

The binary accepts PHP via stdin (legacy mode) or a JSON request on stdin (`--json` mode):

```bash
# Legacy: pipe source, get formatted source on stdout
echo '<?php $a = 1; $foo = 2;' | php_formatter

# JSON mode: send a request object, receive a response object
echo '{"command":"format","source":"<?php $a=1;\n$foo=2;\n"}' | php_formatter --json

# Check mode: returns diagnostics without modifying source
echo '{"command":"check","source":"<?php $a=1;\n"}' | php_formatter --json
```

---

## Changelog

### v0.1.0 — Initial release

- `=` alignment for consecutive assignment blocks
- Indentation normalisation (tabs → spaces)
- Spacing normalisation around operators and commas
- Bundled Windows x86-64 binary
- VS Code formatter provider (`Shift+Alt+F`)

### Upcoming

- `=>` alignment for arrays and `match` expressions *(in progress)*
- Inline `//` comment alignment *(in progress)*
- `@fmt-off` / `@fmt-on` region exclusion *(in progress)*
- Format on save *(in progress)*
- Preview diff before applying *(in progress)*
- Per-project `.phpfmt.toml` configuration *(in progress)*
- Problems panel diagnostics with Quick Fix *(in progress)*
- Bulk format (workspace / folder) *(in progress)*
- macOS and Linux binaries

---

## License

MIT License.
