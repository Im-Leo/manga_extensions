/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/**
 * Every persisted settings key, declared once.
 *
 * Reset iterates this registry, so a setting cannot be added without also being
 * reset: `Application` offers no way to enumerate what a source has written.
 */
export const SETTING_KEYS = {
  discoverSectionOrder: "discover_section_order",
  popularEnabled: "popular_enabled",
  latestUpdatesEnabled: "latest_updates_enabled",
  recommendedEnabled: "recommended_enabled",
  selfPublishedEnabled: "self_published_enabled",
  seasonalEnabled: "seasonal_enabled",
  recentlyAddedEnabled: "recently_added_enabled",
  languages: "languages",
  languagePriority: "language_priority",
  romanizedPriorityEnabled: "romanized_priority_enabled",
  nativeTitleDisplay: "native_title_display",
  ratings: "ratings",
  dataSaver: "data_saver",
  forcePort443: "force_port_443",
  skipSameChapter: "skip_same_chapter",
  includeUnavailable: "include_unavailable",
  showAltTitlesInSynopsis: "show_alt_titles_in_synopsis",
  showFinalChapterInSynopsis: "show_final_chapter_in_synopsis",
  tryFirstVolumeCover: "try_first_volume_cover",
  discoverThumbnail: "discover_thumbnail",
  searchThumbnail: "search_thumbnail",
  mangaThumbnail: "manga_thumbnail",
  showStatusIcons: "show_status_icons",
  showContentRatingIcons: "show_content_rating_icons",
  showVolumeInSubtitle: "show_volume_in_subtitle",
  showChapterInSubtitle: "show_chapter_in_subtitle",
  showSearchRatingSubtitle: "show_search_rating_subtitle",
  relevanceScoringEnabled: "relevance_scoring_enabled",
  blockedGroups: "blocked_groups",
  groupBlockingEnabled: "group_blocking_enabled",
  fuzzyBlockingEnabled: "fuzzy_blocking_enabled",
  blockedUploaders: "blocked_uploaders",
  updateBatchSize: "update_batch_size",
  optimizeUpdates: "optimize_updates",
  metadataUpdater: "metadata_updater",
  skipPublicationStatus: "skip_publication_status",
  skipNewChapters: "skip_new_chapters",
  skipUnreadChapters: "skip_unread_chapters",
} as const;

/** Schema versions for settings whose stored format has changed; not user settings, so never reset. */
export const SCHEMA_KEYS = {
  discoverSectionOrderSchema: "discover_section_order_schema",
  thumbnailQualitySchema: "thumbnail_quality_schema",
} as const;
