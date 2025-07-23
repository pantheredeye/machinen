import fs from "node:fs";
import path from "node:path";

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import archiver from "archiver";
import ignore from "ignore";

const PROJECT_PATH: string = process.cwd();

// Define the FileInfo interface
interface FileInfo {
  path: string;
  name: string;
  type: "file" | "directory";
}

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Middleware
app.use("*", logger());
app.use("*", cors({ origin: "*" }));
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'", "ws:", "wss:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  })
);

// Routes

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// File system routes group
const fsRoutes = new Hono();

fsRoutes.get("/list", (c) => {
  // Get query parameters
  const pathname = c.req.query("pathname");
  if (!pathname) {
    return c.json(
      {
        error: "Bad Request",
        message: "pathname is required",
      },
      400
    );
  }

  let absPath = path.join(PROJECT_PATH, pathname);
  if (!fs.statSync(absPath).isDirectory()) {
    // pop off the filename part of the absPath
    absPath = path.dirname(absPath);
  }

  const files = fs.readdirSync(absPath, {
    withFileTypes: true,
  });

  const fileList: FileInfo[] = files.map((file: fs.Dirent): FileInfo => {
    return {
      path: path
        .join(file.parentPath || "", file.name)
        .slice(PROJECT_PATH.length),
      name: file.name,
      type: file.isDirectory() ? "directory" : "file",
    };
  });
  return c.json(fileList);
});

fsRoutes.get("/stat", (c) => {
  const pathname = c.req.query("pathname") as string;
  const stat = fs.statSync(path.join(PROJECT_PATH, pathname));
  return c.json({ type: stat.isDirectory() ? "directory" : "file" });
});

fsRoutes.get("/read", (c) => {
  const pathname = c.req.query("pathname") as string;
  const content = fs.readFileSync(path.join(PROJECT_PATH, pathname), "utf8");
  return c.json({ content });
});

// write
fsRoutes.post("/write", async (c) => {
  const pathname = c.req.query("pathname") as string;
  const body = await c.req.json();
  fs.writeFileSync(path.join(PROJECT_PATH, pathname), body.content);
  return c.json({ message: "File written successfully" });
});

// delete
// fsRoutes.delete("/delete", (c) => {
//   // TODO.
// });

fsRoutes.get("/archive", async (c) => {
  try {
    // Read .gitignore file
    const gitignorePath = path.join(PROJECT_PATH, ".gitignore");
    let ig = ignore();

    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      ig = ig.add(gitignoreContent);
    }

    // Create zip archive
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Add files to archive, respecting .gitignore
    const addDirectoryToArchive = (
      dirPath: string,
      archivePath: string = ""
    ) => {
      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const relativePath = path.relative(PROJECT_PATH, fullPath);
        const archiveFilePath = path.join(archivePath, file);

        // Skip if ignored by .gitignore
        if (ig.ignores(relativePath)) {
          continue;
        }

        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          addDirectoryToArchive(fullPath, archiveFilePath);
        } else {
          archive.file(fullPath, { name: archiveFilePath });
        }
      }
    };

    addDirectoryToArchive(PROJECT_PATH);
    archive.finalize();

    // Return zip as streaming response
    return new Response(archive as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=app.zip",
      },
    });
  } catch (error) {
    console.error("Archive creation error:", error);
    return c.json(
      {
        error: "Failed to create archive",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

app.route("/fs", fsRoutes);

const ttyRoutes = new Hono();

const shell = pty.spawn("bash", [], {
  name: "xterm-color",
  cols: 80,
  rows: 24,
  encoding: "utf-8",
});

console.log("shell launched:", shell.pid);

ttyRoutes.get(
  "/attach",
  upgradeWebSocket(
    () => {
      console.log("WebSocket upgrade request received");

      return {
        onOpen: (e, ws) => {
          console.log("WebSocket opened");
          shell.onData((data) => {
            ws.send(data);
          });
        },
        onMessage: (e, ws) => {
          console.log("WebSocket message received");
          shell.write(e.data.toString());
        },
        onError: (error) => {
          console.error("WebSocket error:", error);
        },
        onClose: (_e, ws) => {
          console.log("Connection closed");
          ws.close();
        },
      };
    },
    {
      onError: (error) => {
        console.error("WebSocket error:", error);
      },
    }
  )
);

app.route("/tty", ttyRoutes);

// Error handling
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: "The requested resource was not found",
    },
    404
  );
});

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: "Something went wrong on the server",
    },
    500
  );
});

// Start the server
const port = 8911;
console.log(`🚀 Hono server starting on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});
injectWebSocket(server);
