import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "@/app/Document";
import { env } from "cloudflare:workers";

import { EditorPage } from "@/app/pages/editor/EditorPage";
import { TermPage } from "@/app/pages/TermPage";
import { fetchContainer } from "./container";
import { SessionPage } from "./app/pages/session/SessionPage";

export { MachinenContainer } from "./container";

export default defineApp([
  render(Document, [
    route("/", () => {
      return <SessionPage />;
    }),
    // this will be the container id.
    route("/editor/:containerId", EditorPage),
    route("/editor/:containerId/*", EditorPage),
    route("/term/:containerId", TermPage),
  ]),

  route("/preview/:containerId*", async ({ request, params }) => {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(`/preview/${params.containerId}`, "");

    const headers = new Headers(request.headers);
    const internalQuery = url.searchParams.get("__x_internal_query");
    if (internalQuery) {
      const originalQuery = decodeURIComponent(internalQuery);
      url.search = originalQuery ? "?" + originalQuery : "";
      url.searchParams.delete("__x_internal_query");
    }

    if (headers.has("x-websocket-protocol")) {
      console.log(
        `Renaming 'x-websocket-protocol' to 'sec-websocket-protocol' for ${request.url}`
      );
      headers.set(
        "sec-websocket-protocol",
        headers.get("x-websocket-protocol")!
      );
      headers.delete("x-websocket-protocol");
    }
    const requestInit: RequestInit = {
      method: request.method,
      body: request.body ? request.body : undefined,
      redirect: request.redirect,
    };

    return fetchContainer({
      id: params.containerId,
      request: new Request(url, requestInit),
      port: "8910",
    });
  }),

  route("/tty/:containerId/attach", async ({ request, params }) => {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(`/tty/${params.containerId}`, "/tty");

    const response = await fetchContainer({
      id: params.containerId,
      request: new Request(url, request),
    });
    return response;
  }),

  route("/archive/:containerId", async ({ request, params }) => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      // Request zip stream from container
      const zipResponse = await fetchContainer({
        id: params.containerId,
        request: new Request("http://localhost:8911/fs/archive", {
          method: "GET",
        }),
      });

      if (!zipResponse.ok) {
        throw new Error(`Container returned ${zipResponse.status}: ${zipResponse.statusText}`);
      }

      const archiveId = `${Date.now()}-${crypto.randomUUID()}`;
      const key = `archives/${params.containerId}/${archiveId}.zip`;

      // Stream directly to R2
      await env.BUCKET_STASH.put(key, zipResponse.body, {
        customMetadata: {
          containerId: params.containerId,
          createdAt: new Date().toISOString(),
        },
      });

      return new Response(JSON.stringify({
        archiveId,
        key,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: "Failed to store archive",
        message: error instanceof Error ? error.message : "Unknown error",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
]);
