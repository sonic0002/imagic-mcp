# Imagic MCP Server

Convert, resize, and merge images directly from Claude Desktop, Cursor, and other MCP-compatible AI assistants — locally, with no uploads.

## Requirements

- Node.js 18 or later (includes npm)

## Installation

No clone needed. The package is distributed via npm. Configure your AI tool to run it with `npx` and it will be fetched automatically on first use.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "imagic": {
      "command": "npx",
      "args": ["-y", "imagic-mcp"]
    }
  }
}
```

Restart Claude Desktop. The Imagic tools will appear automatically.

### Cursor

Create or edit `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "imagic": {
      "command": "npx",
      "args": ["-y", "imagic-mcp"]
    }
  }
}
```

## Usage Examples

Once configured, just ask your AI assistant:

- "Convert `/tmp/photo.png` to WebP"
- "Resize `/home/user/logo.png` to a favicon"
- "Convert and resize `/tmp/banner.jpg` to an Instagram square"
- "Resize `/tmp/photo.jpg` to 800×600, keep aspect ratio"
- "Merge `/tmp/left.png` and `/tmp/right.png` side by side and save to `/tmp/merged.png`"
- "Stack these three images vertically with a 20px gap: `/tmp/a.jpg`, `/tmp/b.jpg`, `/tmp/c.jpg`"
- "Arrange `/tmp/img1.png`, `/tmp/img2.png`, `/tmp/img3.png`, `/tmp/img4.png` in a grid"

## Tool Reference

| Tool | Key Parameters | Description |
|---|---|---|
| `convert_image` | `input_path`, `output_format`, `quality`, `output_path` | Convert an image to a different format |
| `resize_image` | `input_path`, `width`, `height`, `preset`, `lock_aspect_ratio`, `output_path` | Resize an image to custom dimensions or a named preset |
| `convert_and_resize` | All parameters from both tools above | Convert and resize in a single operation |
| `merge_images` | `input_paths`, `layout`, `gap`, `background`, `output_path` | Merge multiple images into one |

All parameters except `input_path` / `input_paths` and `output_format` / `output_path` are optional. Output for convert/resize defaults to the same directory as the input with a new extension.

### `merge_images` details

| Parameter | Type | Default | Description |
|---|---|---|---|
| `input_paths` | string[] (min 2) | — | Ordered list of absolute image paths |
| `layout` | `horizontal` \| `vertical` \| `grid` | `horizontal` | How to arrange the images |
| `gap` | integer ≥ 0 | `0` | Gap in pixels between images |
| `background` | hex string | `#ffffff` | Canvas/gap fill color |
| `output_path` | string | — | Absolute output path (format inferred from extension) |

Layouts:
- **horizontal** — images placed side by side, centered vertically
- **vertical** — images stacked top to bottom, centered horizontally
- **grid** — auto columns (`ceil(√n)`), each image centered in equal-size cells

### Supported Formats

`png`, `jpeg`, `gif`, `webp`, `ico`

ICO encoding is built in — no extra dependencies required.

### Presets

| Preset Name | Dimensions |
|---|---|
| `instagram-square` | 1080 × 1080 |
| `instagram-portrait` | 1080 × 1350 |
| `instagram-landscape` | 1080 × 566 |
| `twitter-post` | 1200 × 675 |
| `twitter-header` | 1500 × 500 |
| `full-hd` | 1920 × 1080 |
| `4k` | 3840 × 2160 |
| `youtube-thumbnail` | 1280 × 720 |
| `favicon` | 32 × 32 |

## Local Development & Testing

Use these steps to test the server from source before publishing to npm.

### 1. Install dependencies

```bash
cd mcp
npm install
```

### 2. Smoke-test the server starts

```bash
node index.js
```

It should block on stdin with no output — that's correct. Press `Ctrl+C` to exit.

### 3. Send a raw JSON-RPC call

Pipe a request directly to verify a tool works end-to-end:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"convert_image","arguments":{"input_path":"/tmp/test.png","output_format":"webp"}}}' \
  | node index.js
```

You should see a JSON response with `"success": true` and the output path.

### 4. Point Claude Desktop or Cursor at the local source

Instead of `npx`, use `node` with an absolute path in your config:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imagic": {
      "command": "node",
      "args": ["/absolute/path/to/imagic/mcp/index.js"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "imagic": {
      "command": "node",
      "args": ["/Users/pike6/work/project/website/imagic/mcp/index.js"]
    }
  }
}
```

Restart Claude Desktop (or reload the Cursor window) after editing the config. Ask your AI assistant to convert or resize an image — it will call the local file directly.

### 5. Test with `npm link` (optional)

`npm link` makes the `imagic-mcp` binary available globally from your local source, which is the closest simulation to the published `npx` flow:

```bash
cd mcp
npm link
```

Then update your config to use `imagic-mcp` (same as the published form):

```json
{ "command": "imagic-mcp", "args": [] }
```

Run `npm unlink -g imagic-mcp` when you're done testing.

## Privacy

Everything runs locally on your machine via stdio. Your images never leave your device and no internet connection is required for image processing.

## For Repo Owners: Publishing to npm

Run once inside this directory after creating a free account at npmjs.com:

```bash
npm publish
```

For subsequent updates, bump the `version` field in `package.json` then run `npm publish` again.
