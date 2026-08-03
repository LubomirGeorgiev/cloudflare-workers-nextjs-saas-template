import type { ApiReferenceView } from "@/lib/api/reference-model";

import { ApiMethodBadge } from "./api-operation";
import { filterAttributes, GROUP_FILTER_ATTRIBUTES } from "./api-reference-dom";

// Jump list for the whole surface. Plain anchors into the server-rendered cards, so it works before
// hydration; the filter hides the same entries it hides in the list itself.
export function ApiReferenceIndex({ view }: { view: ApiReferenceView }) {
  return (
    <nav className="space-y-5">
      {view.groups.map((group) => (
        <div key={group.name} {...GROUP_FILTER_ATTRIBUTES} className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {group.name}
          </p>

          <ul>
            {group.operations.map((operation) => (
              <li
                key={operation.operationId}
                {...filterAttributes({
                  target: "index",
                  searchText: operation.searchText,
                  method: operation.method,
                })}
              >
                <a
                  href={`#${operation.anchorId}`}
                  className="flex items-baseline gap-2 rounded py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ApiMethodBadge method={operation.method} className="mt-0.5" />
                  <span className="min-w-0 flex-1 truncate">{operation.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
