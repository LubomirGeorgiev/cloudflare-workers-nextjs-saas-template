import { cmsNavigationKeys } from "@/../cms.config";
import {
  CMS_COLOR_MAX_LENGTH,
  CMS_ICON_KEY_MAX_LENGTH,
  CMS_ICON_UPLOAD_MAX_LENGTH,
  CMS_MAX_NAVIGATION_NODES,
  CMS_NAVIGATION_TITLE_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from "@/constants";
import { isAllowedIconPrefix } from "@/constants/cms-icons";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import {
  encodeValidationMessage,
  maxString,
  requiredString,
  trimmedString,
  v,
  validationKey,
} from "@/lib/validation";
import { idField } from "@/schemas/fields";
import { cmsNavigationNodeTypeTuple } from "@/types/cms-navigation";

const navigationTitleField = trimmedString({ min: 1, max: CMS_NAVIGATION_TITLE_MAX_LENGTH });

// An Iconify key, `{prefix}:{name}`. The client sends the key and never the SVG body: the server
// is the only writer of `iconBody`, so this pattern is what bounds what a save can ask us to fetch.
// Length before pattern, and `abortPipeEarly`, so the regex never runs on an unbounded string.
// The prefix check pins the licensed catalog here, where the admin reads the message, instead of
// letting `parseIconKey` refuse it a layer down as a bare NOT_FOUND.
const cmsIconKeyField = v.config(
  v.pipe(
    requiredString(),
    v.maxLength(
      CMS_ICON_KEY_MAX_LENGTH,
      encodeValidationMessage("maxLength", { max: CMS_ICON_KEY_MAX_LENGTH })
    ),
    v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/, validationKey("invalidIconKey")),
    v.check(
      (key) => isAllowedIconPrefix(key.slice(0, key.indexOf(":"))),
      validationKey("invalidIconKey")
    )
  ),
  { abortPipeEarly: true }
);

const cmsNavigationFlatNodeSchema = v.object({
  id: idField(),
  parentId: v.nullable(idField()),
  nodeType: v.picklist(cmsNavigationNodeTypeTuple),
  title: navigationTitleField,
  // Per-locale title overrides; repository sanitizes/drops default-locale + empties.
  titleTranslations: v.optional(
    v.nullable(v.record(v.picklist(LOCALES), maxString(CMS_NAVIGATION_TITLE_MAX_LENGTH)))
  ),
  icon: v.optional(v.nullable(cmsIconKeyField)),
  // The uploaded `<svg>` behind a `custom:` key. The client sends the document, never the parsed
  // body: `saveCmsNavigationTree` re-parses it, so the server stays the only writer of `iconBody`.
  // Sent only for a key the stored tree holds no body for, so an unchanged tree carries none.
  iconSvg: v.optional(v.nullable(maxString(CMS_ICON_UPLOAD_MAX_LENGTH))),
  // A CSS colour token, not free text — the same rule the tag badge colour follows.
  iconColor: v.optional(v.nullable(maxString(CMS_COLOR_MAX_LENGTH))),
  entryId: v.nullable(idField()),
  slugSegment: v.nullable(maxString(SLUG_MAX_LENGTH)),
  sortOrder: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const saveCmsNavigationTreeSchema = v.object({
  navigationKey: v.picklist(cmsNavigationKeys),
  // The whole tree arrives in one payload, so the node count is bounded like every other input.
  items: v.pipe(v.array(cmsNavigationFlatNodeSchema), v.maxLength(CMS_MAX_NAVIGATION_NODES)),
});

export const translateNavTitleSchema = v.object({
  title: trimmedString({
    min: 1,
    max: CMS_NAVIGATION_TITLE_MAX_LENGTH,
    minMessage: "Title is required",
  }),
  sourceLocale: v.optional(v.picklist(LOCALES), DEFAULT_LOCALE),
});
