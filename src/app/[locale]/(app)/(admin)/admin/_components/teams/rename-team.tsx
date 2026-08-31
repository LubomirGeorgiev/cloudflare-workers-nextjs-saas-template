"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEAM_NAME_MAX_LENGTH } from "@/constants";
import { setTeamNameAction } from "../../_actions/team-actions";

// The slug is deliberately not editable here: it is the team's URL, and every invitation email
// already in flight resolves through it. Same rule the member-facing rename follows.
export function RenameTeam({ teamId, currentName }: { teamId: string; currentName: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const router = useRouter();

  const { execute, isExecuting } = useAction(setTeamNameAction, {
    onSuccess: () => {
      toast.success("Team renamed");
      setIsEditing(false);
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to rename the team");
    },
  });

  if (!isEditing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
        <Pencil className="mr-1 h-3 w-3" />
        Rename
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      <Input
        aria-label="Team name"
        value={name}
        maxLength={TEAM_NAME_MAX_LENGTH}
        onChange={(event) => setName(event.target.value)}
        disabled={isExecuting}
        className="w-64"
      />
      <Button
        variant="outline"
        size="icon"
        aria-label="Save the new name"
        onClick={() => execute({ teamId, name })}
        disabled={isExecuting}
      >
        {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="Cancel"
        onClick={() => {
          setName(currentName);
          setIsEditing(false);
        }}
        disabled={isExecuting}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
