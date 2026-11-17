/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  Form,
  LabelRow,
  Section,
  SelectRow,
  StepperRow,
  type FormSectionElement,
  type SourceManga,
} from "@paperback/types";

import { errorMessage } from "../../utils/text";
import { readingStatuses, type AsuraBookmark, type AsuraScansReadingStatus } from "../models";
import { createBookmark, findBookmark, seriesIdOf, updateBookmark } from "../tracking";

/** Chapter ceiling when the series reports no count, so the stepper stays usable. */
const UNKNOWN_CHAPTER_COUNT = 9999;

function toReadingStatus(value: string | undefined): AsuraScansReadingStatus {
  return readingStatuses.find((status) => status.id === value)?.id ?? "reading";
}

/**
 * Edits the reading progress AsuraScans stores against a bookmark.
 *
 * Nothing is written until Done: a title without a bookmark gets one on submit,
 * so opening the form and canceling leaves the account untouched.
 */
export class TrackingForm extends Form {
  override readonly requiresExplicitSubmission = true;

  private bookmark?: AsuraBookmark;
  private status: AsuraScansReadingStatus = "reading";
  private lastReadChapter = 0;
  private loading = true;
  private loadError?: string;

  constructor(private readonly sourceManga: SourceManga) {
    super();
  }

  override formWillAppear(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.bookmark = await findBookmark(this.sourceManga);
      this.status = toReadingStatus(this.bookmark?.status);
      this.lastReadChapter = this.bookmark?.last_read_chapter ?? 0;
    } catch (error) {
      this.loadError = errorMessage(error);
    } finally {
      this.loading = false;
      this.reloadForm();
    }
  }

  /** Throwing keeps the form open and shows the app's alert with this message. */
  override async formDidSubmit(): Promise<void> {
    if (this.loading || this.loadError) return;

    const seriesId = seriesIdOf(this.sourceManga);
    if (!this.bookmark) await createBookmark(seriesId);
    await updateBookmark(seriesId, {
      status: this.status,
      last_read_chapter: this.lastReadChapter,
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (this.loading) {
      return [Section("loading", [LabelRow("loading", { title: "Loading your progress…" })])];
    }

    if (this.loadError) {
      return [
        Section("error", [
          LabelRow("error", { title: "Could not load progress", subtitle: this.loadError }),
        ]),
      ];
    }

    return [
      Section(
        {
          id: "progress",
          header: "Progress",
          footer: this.bookmark
            ? undefined
            : "Not in your bookmarks yet. Tapping Done adds it with the progress below.",
        },
        [
          SelectRow("status", {
            title: "Status",
            value: [this.status],
            minItemCount: 1,
            maxItemCount: 1,
            options: readingStatuses.map((status) => ({ id: status.id, title: status.name })),
            onValueChange: Application.Selector(this as TrackingForm, "statusUpdate"),
          }),
          StepperRow("chapterProgress", {
            title: "Chapters",
            subtitle: "The highest read chapter number",
            value: this.lastReadChapter,
            minValue: 0,
            maxValue: this.bookmark?.series.chapter_count || UNKNOWN_CHAPTER_COUNT,
            stepValue: 1,
            loopOver: false,
            onValueChange: Application.Selector(this as TrackingForm, "chapterProgressUpdate"),
          }),
        ],
      ),
    ];
  }

  async statusUpdate(value: string[]): Promise<void> {
    this.status = toReadingStatus(value[0]);
  }

  async chapterProgressUpdate(value: number): Promise<void> {
    this.lastReadChapter = value;
    this.reloadForm();
  }
}
