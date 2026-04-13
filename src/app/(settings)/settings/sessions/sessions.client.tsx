"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "next-safe-action/hooks";
import { deleteSessionAction } from "./sessions.actions";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SessionWithMeta } from "@/types";
import { capitalize } from 'remeda'


const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function SessionsClient({ sessions }: { sessions: SessionWithMeta[] }) {
  const router = useRouter();
  const dialogCloseRef = React.useRef<HTMLButtonElement>(null);
  const { execute: deleteSession } = useAction(deleteSessionAction, {
    onSuccess: () => {
      toast.success("Session deleted");
      dialogCloseRef.current?.click();
      router.refresh();
    }
  });

  return (
    <div className="space-y-4">
      {sessions.map((session) => (
        <Card key={session.id} className={cn(!session.isCurrentSession ? "bg-card/40" : "border-3 border-primary/20 shadow-lg bg-secondary/30")}>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {session.city && session.country
                      ? `${session.city}, ${regionNames.of(session.country)}`
                      : session.country || "Unknown location"}
                    {session.isCurrentSession && <Badge>Current Session</Badge>}
                  </CardTitle>
                  {session?.authenticationType && (
                    <Badge variant='outline'>
                      Authenticated with {capitalize(session?.authenticationType ?? "password")?.replace("-", " ")}
                    </Badge>
                  )}
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    &nbsp;· &nbsp;{formatDistanceToNow(session.createdAt)} ago
                  </div>
                </div>
                <CardDescription className="text-sm">
                  {session.parsedUserAgent?.browser.name ?? "Unknown browser"} {session.parsedUserAgent?.browser.major ?? "Unknown version"} on {session.parsedUserAgent?.device.vendor ?? "Unknown device"} {session.parsedUserAgent?.device.model ?? "Unknown model"} {session.parsedUserAgent?.device.type ?? "Unknown type"} ({session.parsedUserAgent?.os.name ?? "Unknown OS"} {session.parsedUserAgent?.os.version ?? "Unknown version"})
                </CardDescription>
              </div>
              <div>
                {!session?.isCurrentSession && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="destructive" className="w-full sm:w-auto">Delete session</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete session?</DialogTitle>
                        <DialogDescription>
                          This will sign out this device. This action cannot be undone.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter className="mt-6 sm:mt-0">
                        <DialogClose ref={dialogCloseRef} asChild>
                          <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button
                          variant="destructive"
                          className="mb-4 sm:mb-0"
                          onClick={() => deleteSession({ sessionId: session.id })}
                        >
                          Delete session
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
