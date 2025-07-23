"use server";

import { env } from "cloudflare:workers";

import { fetchContainer } from "@/container";

export interface FileItem {
  path: string;
  name: string;
  type: "file" | "directory";
}

async function containerFilesFetch(
  pathname: string,
  containerId: string,
  action:
    | "/fs/list"
    | "/fs/read"
    | "/fs/stat"
    | "/fs/delete"
    | "/fs/write"
    | "/fs/archive",
  fetchOptions: RequestInit = {}
) {
  // NOTE: This will become a vite pluging, with __machinen/sandbox
  const url = new URL(`http://localhost:8911` + action);
  url.searchParams.set("pathname", pathname);

  const response = await fetchContainer({
    id: containerId,
    request: new Request(url, {
      headers: {
        "Content-Type": "application/json",
      },
      ...fetchOptions,
    }),
  });

  return response.json();
}

export async function getSiblingFiles({
  pathname,
  containerId,
}: {
  pathname: string;
  containerId: string;
}) {
  const files = await containerFilesFetch(pathname, containerId, "/fs/list");
  return files as FileItem[];
}

export async function getFile({
  pathname,
  containerId,
}: {
  pathname: string;
  containerId: string;
}) {
  const file = (await containerFilesFetch(
    pathname,
    containerId,
    "/fs/read"
  )) as {
    content: string;
  };
  return file;
}

export async function fileType({
  pathname,
  containerId,
}: {
  pathname: string;
  containerId: string;
}) {
  const { type } = (await containerFilesFetch(
    pathname,
    containerId,
    "/fs/stat"
  )) as {
    type: "file" | "directory";
  };
  return type;
}

export async function saveFile({
  pathname,
  content,
  containerId,
}: {
  pathname: string;
  content: string;
  containerId: string;
}) {
  return await containerFilesFetch(pathname, containerId, "/fs/write", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function archiveFiles({ containerId }: { containerId: string }) {
  try {
    // Request zip stream from container
    const zipResponse = await fetchContainer({
      id: containerId,
      request: new Request("http://localhost:8911/fs/archive", {
        method: "GET",
      }),
    });

    if (!zipResponse.ok) {
      throw new Error(
        `Container returned ${zipResponse.status}: ${zipResponse.statusText}`
      );
    }

    const archiveId = `${Date.now()}-${crypto.randomUUID()}`;
    const key = `archives/${containerId}/${archiveId}.zip`;

    // Stream directly to R2
    await env.BUCKET_STASH.put(key, zipResponse.body, {
      customMetadata: {
        containerId,
        createdAt: new Date().toISOString(),
      },
    });

    return {
      archiveId,
      key,
    };
  } catch (error) {
    console.error(error);
    throw new Error("Failed to store archive");
    // return new Response(JSON.stringify({
    //   error: "Failed to store archive",
    //   message: error instanceof Error ? error.message : "Unknown error",
    // }), {
    //   status: 500,
    //   headers: { "Content-Type": "application/json" },
    // });
  }
}
