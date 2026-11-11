import { notFound } from "next/navigation";

// A path that no route matches would skip the `[locale]` tree and get the bare framework 404.
// This catch-all keeps it inside the tree, so `../not-found.tsx` answers in the URL locale.
export default function UnmatchedPathPage(): never {
  notFound();
}
