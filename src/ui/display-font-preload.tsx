"use client";

import { preload } from "react-dom";

export function DisplayFontPreload() {
  preload("/fonts/nothing-open/Doto-ROND-wght.woff2", {
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  });
  return null;
}
