import {
  CMS_ICON_SEARCH_QUERY_MAX_LENGTH,
  CMS_ICON_UPLOAD_MAX_LENGTH,
  CMS_TITLE_MAX_LENGTH,
} from "@/constants";
import { trimmedString, v } from "@/lib/validation";

// The query is the whole input: a search always covers every licensed set, and the server owns how
// many results each set contributes.
export const searchCmsIconsSchema = v.object({
  query: trimmedString({ min: 1, max: CMS_ICON_SEARCH_QUERY_MAX_LENGTH }),
});

// One uploaded SVG, on its way to a preview. Nothing is stored: the action parses the document and
// hands back the body and the key, and the same document is re-parsed when the tree is saved.
// `label` is the file name the admin picked it with; only its slug reaches the key.
export const parseCmsCustomIconSchema = v.object({
  label: trimmedString({ min: 1, max: CMS_TITLE_MAX_LENGTH }),
  svg: trimmedString({ min: 1, max: CMS_ICON_UPLOAD_MAX_LENGTH }),
});
