"use client";

import { archiveFiles } from "./functions";

import { Button } from "@/app/components/ui/button";

export const ArchiveButton = ({ containerId }: { containerId: string }) => {
  return <Button onClick={() => archiveFiles({ containerId })}>Archive</Button>;
};
