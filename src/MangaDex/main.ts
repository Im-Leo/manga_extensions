/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { BasicRateLimiter, type ExtensionImpl } from "@paperback/types";

import { getChapterDetails, getChapters } from "./chapters";
import {
  applyManagedCollectionChanges,
  getManagedCollectionItems,
  getManagedCollections,
} from "./collection";
import { getDiscoverSectionItems, getDiscoverSections } from "./discover";
import { getMangaDetails } from "./manga";
import { MangaDexInterceptor } from "./network";
import type MangaDexConfig from "./pbconfig";
import { getAdvancedSearchForm, getSearchResults, getSortingOptions } from "./search";
import { getSettingsForm } from "./settings";
import { runStateMigrations } from "./state";
import { processTitlesForUpdates } from "./updates";

export class MangaDexExtension implements ExtensionImpl<typeof MangaDexConfig> {
  private readonly rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly interceptor = new MangaDexInterceptor("main");

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
    runStateMigrations();
  }

  getMangaDetails = getMangaDetails;
  getManagedCollections = getManagedCollections;
  getManagedCollectionItems = getManagedCollectionItems;
  applyManagedCollectionChanges = applyManagedCollectionChanges;
  getSettingsForm = getSettingsForm;
  getAdvancedSearchForm = getAdvancedSearchForm;
  getSearchResults = getSearchResults;
  getSortingOptions = getSortingOptions;
  getDiscoverSections = getDiscoverSections;
  getDiscoverSectionItems = getDiscoverSectionItems;
  getChapters = getChapters;
  getChapterDetails = getChapterDetails;
  processTitlesForUpdates = processTitlesForUpdates;
}

export const MangaDex = new MangaDexExtension();
