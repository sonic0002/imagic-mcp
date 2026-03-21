#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

const PRESETS = {
  "instagram-square":    { width: 1080, height: 1080 },
  "instagram-portrait":  { width: 1080, height: 1350 },
  "instagram-landscape": { width: 1080, height: 566  },
  "twitter-post":        { width: 1200, height: 675  },
  "twitter-header":      { width: 1500, height: 500  },
  "full-hd":             { width: 1920, height: 1080 },
  "4k":                  { width: 3840, height: 2160 },
  "youtube-thumbnail":   { width: 1280, height: 720  },
  "favicon":             { width: 32,   height: 32   },
};

function resolveOutputPath(inputPath, ext, explicit) {
  if (explicit) return explicit;
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}.${ext}`);
}

async function encodeIco(inputPath) {
  const { data, info } = await sharp(inputPath)
    .resize(32, 32, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // Convert RGBA -> BGRA and flip rows bottom-to-top
  const bgraFlipped = Buffer.alloc(data.length);
  for (let row = 0; row < h; row++) {
    const srcRow = h - 1 - row;
    for (let col = 0; col < w; col++) {
      const src = (srcRow * w + col) * 4;
      const dst = (row * w + col) * 4;
      bgraFlipped[dst]     = data[src + 2]; // B
      bgraFlipped[dst + 1] = data[src + 1]; // G
      bgraFlipped[dst + 2] = data[src];     // R
      bgraFlipped[dst + 3] = data[src + 3]; // A
    }
  }

  const ICONDIR_SIZE = 6;
  const ICONDIRENTRY_SIZE = 16;
  const BITMAPINFOHEADER_SIZE = 40;
  const pixelDataSize = bgraFlipped.length;
  const imageDataSize = BITMAPINFOHEADER_SIZE + pixelDataSize;
  const totalSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE + imageDataSize;

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // ICONDIR
  buf.writeUInt16LE(0, offset);       // reserved
  buf.writeUInt16LE(1, offset + 2);   // type: 1 = ICO
  buf.writeUInt16LE(1, offset + 4);   // count: 1 image
  offset += 6;

  // ICONDIRENTRY
  buf.writeUInt8(w >= 256 ? 0 : w, offset);        // width (0 = 256)
  buf.writeUInt8(h >= 256 ? 0 : h, offset + 1);    // height (0 = 256)
  buf.writeUInt8(0, offset + 2);      // color count (0 = no palette)
  buf.writeUInt8(0, offset + 3);      // reserved
  buf.writeUInt16LE(1, offset + 4);   // color planes
  buf.writeUInt16LE(32, offset + 6);  // bits per pixel
  buf.writeUInt32LE(imageDataSize, offset + 8);
  buf.writeUInt32LE(ICONDIR_SIZE + ICONDIRENTRY_SIZE, offset + 12); // offset to image data
  offset += 16;

  // BITMAPINFOHEADER
  buf.writeUInt32LE(BITMAPINFOHEADER_SIZE, offset);    // header size
  buf.writeInt32LE(w, offset + 4);                     // width
  buf.writeInt32LE(h * 2, offset + 8);                 // height * 2 (XOR + AND masks)
  buf.writeUInt16LE(1, offset + 12);                   // color planes
  buf.writeUInt16LE(32, offset + 14);                  // bits per pixel
  buf.writeUInt32LE(0, offset + 16);                   // compression: BI_RGB
  buf.writeUInt32LE(pixelDataSize, offset + 20);       // image size
  buf.writeInt32LE(0, offset + 24);                    // X pixels per meter
  buf.writeInt32LE(0, offset + 28);                    // Y pixels per meter
  buf.writeUInt32LE(0, offset + 32);                   // colors used
  buf.writeUInt32LE(0, offset + 36);                   // important colors
  offset += 40;

  bgraFlipped.copy(buf, offset);

  return buf;
}

const server = new McpServer({ name: "imagic-mcp", version: "1.0.0" });

server.tool(
  "convert_image",
  "Convert an image to a different format (PNG, JPEG, GIF, WebP, or ICO).",
  {
    input_path: z.string().describe("Absolute path to the source image file"),
    output_format: z.enum(["png", "jpeg", "gif", "webp", "ico"]).describe("Target format"),
    quality: z.number().int().min(1).max(100).optional().describe("JPEG/WebP quality (1-100, default 90)"),
    output_path: z.string().optional().describe("Where to save the output (defaults to same directory as input)"),
  },
  async ({ input_path, output_format, quality = 90, output_path }) => {
    try {
      await fs.access(input_path);
      let outPath;
      if (output_format === "ico") {
        outPath = resolveOutputPath(input_path, "ico", output_path);
        const icoBuffer = await encodeIco(input_path);
        await fs.writeFile(outPath, icoBuffer);
      } else {
        outPath = resolveOutputPath(input_path, output_format === "jpeg" ? "jpg" : output_format, output_path);
        let pipeline = sharp(input_path).toFormat(output_format, { quality });
        await pipeline.toFile(outPath);
      }
      const stat = await fs.stat(outPath);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, output_path: outPath, size_bytes: stat.size }) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "resize_image",
  "Resize an image to custom dimensions or a named preset. Preserves the original format.",
  {
    input_path: z.string().describe("Absolute path to the source image file"),
    width: z.number().int().positive().optional().describe("Target width in pixels"),
    height: z.number().int().positive().optional().describe("Target height in pixels"),
    preset: z.enum([
      "instagram-square", "instagram-portrait", "instagram-landscape",
      "twitter-post", "twitter-header", "full-hd", "4k",
      "youtube-thumbnail", "favicon",
    ]).optional().describe("Named size preset (overrides width/height)"),
    lock_aspect_ratio: z.boolean().optional().default(true).describe("Keep aspect ratio (default true)"),
    output_path: z.string().optional().describe("Where to save the output (defaults to same directory as input)"),
  },
  async ({ input_path, width, height, preset, lock_aspect_ratio = true, output_path }) => {
    try {
      await fs.access(input_path);
      let targetW = width;
      let targetH = height;
      if (preset) {
        targetW = PRESETS[preset].width;
        targetH = PRESETS[preset].height;
      }
      if (!targetW && !targetH) {
        return { isError: true, content: [{ type: "text", text: "Provide width, height, or a preset." }] };
      }
      const ext = path.extname(input_path).slice(1).toLowerCase() || "jpg";
      const outPath = resolveOutputPath(input_path, ext, output_path);
      const fit = lock_aspect_ratio ? "inside" : "fill";
      await sharp(input_path).resize(targetW, targetH, { fit }).toFile(outPath);
      const stat = await fs.stat(outPath);
      const meta = await sharp(outPath).metadata();
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, output_path: outPath, width: meta.width, height: meta.height, size_bytes: stat.size }) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "convert_and_resize",
  "Convert an image to a new format and resize it in a single operation.",
  {
    input_path: z.string().describe("Absolute path to the source image file"),
    output_format: z.enum(["png", "jpeg", "gif", "webp", "ico"]).describe("Target format"),
    quality: z.number().int().min(1).max(100).optional().describe("JPEG/WebP quality (1-100, default 90)"),
    width: z.number().int().positive().optional().describe("Target width in pixels"),
    height: z.number().int().positive().optional().describe("Target height in pixels"),
    preset: z.enum([
      "instagram-square", "instagram-portrait", "instagram-landscape",
      "twitter-post", "twitter-header", "full-hd", "4k",
      "youtube-thumbnail", "favicon",
    ]).optional().describe("Named size preset (overrides width/height)"),
    lock_aspect_ratio: z.boolean().optional().default(true).describe("Keep aspect ratio (default true)"),
    output_path: z.string().optional().describe("Where to save the output"),
  },
  async ({ input_path, output_format, quality = 90, width, height, preset, lock_aspect_ratio = true, output_path }) => {
    try {
      await fs.access(input_path);
      let targetW = width;
      let targetH = height;
      if (preset) {
        targetW = PRESETS[preset].width;
        targetH = PRESETS[preset].height;
      }
      const outExt = output_format === "jpeg" ? "jpg" : output_format;
      const outPath = resolveOutputPath(input_path, outExt, output_path);

      if (output_format === "ico") {
        // For ICO, resize to 32x32 via encodeIco (which already resizes)
        const icoBuffer = await encodeIco(input_path);
        await fs.writeFile(outPath, icoBuffer);
      } else {
        let pipeline = sharp(input_path);
        if (targetW || targetH) {
          const fit = lock_aspect_ratio ? "inside" : "fill";
          pipeline = pipeline.resize(targetW, targetH, { fit });
        }
        pipeline = pipeline.toFormat(output_format, { quality });
        await pipeline.toFile(outPath);
      }

      const stat = await fs.stat(outPath);
      const meta = await sharp(outPath).metadata();
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, output_path: outPath, width: meta.width, height: meta.height, size_bytes: stat.size }) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "merge_images",
  "Merge multiple images into a single image by arranging them horizontally, vertically, or in a grid.",
  {
    input_paths: z.array(z.string()).min(2).describe("Ordered list of absolute paths to the images to merge (minimum 2)"),
    layout: z.enum(["horizontal", "vertical", "grid"]).optional().default("horizontal").describe("Arrangement: horizontal (side by side), vertical (stacked), or grid (auto columns)"),
    gap: z.number().int().min(0).optional().default(0).describe("Gap in pixels between images (default 0)"),
    background: z.string().optional().default("#ffffff").describe("Background/gap fill color as hex (default #ffffff)"),
    output_path: z.string().describe("Absolute path for the output file (format inferred from extension)"),
  },
  async ({ input_paths, layout = "horizontal", gap = 0, background = "#ffffff", output_path }) => {
    try {
      // Load metadata for all images
      const metas = await Promise.all(input_paths.map(async (p) => {
        await fs.access(p);
        const meta = await sharp(p).metadata();
        return { path: p, width: meta.width, height: meta.height };
      }));

      // Parse background color
      let bg = { r: 255, g: 255, b: 255, alpha: 1 };
      const hex = background.replace('#', '');
      if (hex.length === 6) {
        bg = { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16), alpha: 1 };
      }

      let canvasW, canvasH, positions;

      if (layout === "horizontal") {
        canvasH = Math.max(...metas.map(m => m.height));
        canvasW = metas.reduce((sum, m) => sum + m.width, 0) + gap * (metas.length - 1);
        positions = [];
        let x = 0;
        for (const m of metas) {
          positions.push({ x, y: Math.floor((canvasH - m.height) / 2) });
          x += m.width + gap;
        }
      } else if (layout === "vertical") {
        canvasW = Math.max(...metas.map(m => m.width));
        canvasH = metas.reduce((sum, m) => sum + m.height, 0) + gap * (metas.length - 1);
        positions = [];
        let y = 0;
        for (const m of metas) {
          positions.push({ x: Math.floor((canvasW - m.width) / 2), y });
          y += m.height + gap;
        }
      } else {
        // grid: auto columns = ceil(sqrt(n))
        const cols = Math.ceil(Math.sqrt(metas.length));
        const rows = Math.ceil(metas.length / cols);
        const cellW = Math.max(...metas.map(m => m.width));
        const cellH = Math.max(...metas.map(m => m.height));
        canvasW = cols * cellW + gap * (cols - 1);
        canvasH = rows * cellH + gap * (rows - 1);
        positions = metas.map((m, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          return {
            x: col * (cellW + gap) + Math.floor((cellW - m.width) / 2),
            y: row * (cellH + gap) + Math.floor((cellH - m.height) / 2),
          };
        });
      }

      // Build composite layers
      const composites = await Promise.all(metas.map(async (m, i) => ({
        input: await sharp(m.path).toBuffer(),
        left: positions[i].x,
        top: positions[i].y,
      })));

      const outExt = path.extname(output_path).slice(1).toLowerCase() || "png";
      const formatMap = { jpg: "jpeg" };
      const fmt = formatMap[outExt] || outExt;

      await sharp({
        create: { width: canvasW, height: canvasH, channels: 4, background: bg },
      })
        .composite(composites)
        .toFormat(fmt)
        .toFile(output_path);

      const stat = await fs.stat(output_path);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, output_path, width: canvasW, height: canvasH, size_bytes: stat.size }) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "avif", "heic", "heif"]);

function isImageFile(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).slice(1).toLowerCase());
}

server.tool(
  "process_folder",
  "Apply a convert, resize, or convert-and-resize operation to all image files in a folder. Non-image files are automatically skipped.",
  {
    folder_path: z.string().describe("Absolute path to the folder containing images"),
    operation: z.enum(["convert", "resize", "convert_and_resize"]).describe("Operation to apply to every image"),
    output_format: z.enum(["png", "jpeg", "gif", "webp", "ico"]).optional().describe("Target format (required for convert / convert_and_resize)"),
    quality: z.number().int().min(1).max(100).optional().describe("JPEG/WebP quality (1-100, default 90)"),
    width: z.number().int().positive().optional().describe("Target width in pixels"),
    height: z.number().int().positive().optional().describe("Target height in pixels"),
    preset: z.enum([
      "instagram-square", "instagram-portrait", "instagram-landscape",
      "twitter-post", "twitter-header", "full-hd", "4k",
      "youtube-thumbnail", "favicon",
    ]).optional().describe("Named size preset (overrides width/height)"),
    lock_aspect_ratio: z.boolean().optional().default(true).describe("Keep aspect ratio when resizing (default true)"),
    output_folder: z.string().optional().describe("Where to save the processed files (defaults to the same folder as input)"),
  },
  async ({ folder_path, operation, output_format, quality = 90, width, height, preset, lock_aspect_ratio = true, output_folder }) => {
    try {
      const stat = await fs.stat(folder_path);
      if (!stat.isDirectory()) {
        return { isError: true, content: [{ type: "text", text: `Error: ${folder_path} is not a directory.` }] };
      }

      const entries = await fs.readdir(folder_path);
      const imageFiles = entries.filter(isImageFile);

      if (imageFiles.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ success: true, processed: 0, skipped: entries.length, results: [] }) }] };
      }

      const outDir = output_folder ?? folder_path;
      if (output_folder) {
        await fs.mkdir(output_folder, { recursive: true });
      }

      let targetW = width;
      let targetH = height;
      if (preset) {
        targetW = PRESETS[preset].width;
        targetH = PRESETS[preset].height;
      }

      const results = [];

      for (const filename of imageFiles) {
        const inputPath = path.join(folder_path, filename);
        try {
          let outPath;

          if (operation === "convert") {
            if (!output_format) throw new Error("output_format is required for convert operation");
            const outExt = output_format === "jpeg" ? "jpg" : output_format;
            const base = path.basename(filename, path.extname(filename));
            outPath = path.join(outDir, `${base}.${outExt}`);

            if (output_format === "ico") {
              const icoBuffer = await encodeIco(inputPath);
              await fs.writeFile(outPath, icoBuffer);
            } else {
              await sharp(inputPath).toFormat(output_format, { quality }).toFile(outPath);
            }

          } else if (operation === "resize") {
            if (!targetW && !targetH) throw new Error("Provide width, height, or a preset for resize operation");
            const ext = path.extname(filename).slice(1).toLowerCase() || "jpg";
            outPath = path.join(outDir, filename);
            const fit = lock_aspect_ratio ? "inside" : "fill";
            await sharp(inputPath).resize(targetW, targetH, { fit }).toFile(outPath);

          } else { // convert_and_resize
            if (!output_format) throw new Error("output_format is required for convert_and_resize operation");
            const outExt = output_format === "jpeg" ? "jpg" : output_format;
            const base = path.basename(filename, path.extname(filename));
            outPath = path.join(outDir, `${base}.${outExt}`);

            if (output_format === "ico") {
              const icoBuffer = await encodeIco(inputPath);
              await fs.writeFile(outPath, icoBuffer);
            } else {
              let pipeline = sharp(inputPath);
              if (targetW || targetH) {
                const fit = lock_aspect_ratio ? "inside" : "fill";
                pipeline = pipeline.resize(targetW, targetH, { fit });
              }
              await pipeline.toFormat(output_format, { quality }).toFile(outPath);
            }
          }

          const outStat = await fs.stat(outPath);
          results.push({ file: filename, output_path: outPath, size_bytes: outStat.size, success: true });
        } catch (fileErr) {
          results.push({ file: filename, success: false, error: fileErr.message });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          processed: succeeded,
          failed,
          skipped: entries.length - imageFiles.length,
          results,
        }) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
