/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

import { DEVELOPERS } from "../utils/developers";

export default {
  name: "MangaDex",
  description: "Extension that pulls content from mangadex.org.",
  version: "1.1.2",
  icon: "icon.png",
  language: "multi",
  contentRating: ContentRating.EVERYONE,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.MANAGED_COLLECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  badges: [],
  developers: DEVELOPERS,
} satisfies ExtensionInfo;
