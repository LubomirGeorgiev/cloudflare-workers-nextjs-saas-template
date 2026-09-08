import { Loader2 } from "lucide-react";

// The `loading` state of every `dynamic()` panel the admin lazy-loads. It holds the panel's height
// so the surrounding form does not jump when the real chunk arrives.
export function LazyPanelFallback() {
  return (
    <div className="flex h-64 items-center justify-center rounded-md border">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}
