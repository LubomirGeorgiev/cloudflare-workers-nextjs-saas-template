"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { CmsIconPickerProps } from "./cms-icon-picker-dialog";

// The picker holds a search action and a large results grid that most edits never open, so the
// chunk loads on the first open instead of riding in the navigation editor.
const CmsIconPickerDialog = dynamic(
  async () => (await import("./cms-icon-picker-dialog")).CmsIconPickerDialog,
  { ssr: false },
);

export function CmsIconPicker(props: CmsIconPickerProps) {
  const [wasOpened, setWasOpened] = useState(false);

  useEffect(() => {
    if (props.open) {
      setWasOpened(true);
    }
  }, [props.open]);

  // Stays mounted after the first open so the dialog keeps its close animation and its results.
  if (!wasOpened) {
    return null;
  }

  return <CmsIconPickerDialog {...props} />;
}
