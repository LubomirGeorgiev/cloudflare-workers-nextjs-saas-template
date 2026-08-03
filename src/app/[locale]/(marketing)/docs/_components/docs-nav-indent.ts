// The docs nav renders two lists side by side — the CMS navigation tree and the static route
// links — so their indent has to come from one formula or the columns drift apart.

const INDENT_STEP_PX = 14;
const BASE_PADDING_PX = 12;

export function getDocsNavPaddingLeft(depth: number): string {
  return `${depth * INDENT_STEP_PX + BASE_PADDING_PX}px`;
}
