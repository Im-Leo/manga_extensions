/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type FormSectionElement,
  type SearchQuery,
} from "@paperback/types";

export type SingleGenreMetadata = { genres?: string[] };

export interface GenreOption {
  id: string;
  title: string;
}

/**
 * One genre, and nothing else, for sites that filter by a single genre with no exclusions and no
 * combined query, so the form offers no control the request could not honor.
 */
export class SingleGenreSearchForm extends AdvancedSearchForm {
  private readonly searchMetadata: SingleGenreMetadata;

  constructor(
    searchQuery: SearchQuery<SingleGenreMetadata>,
    private readonly genres: readonly GenreOption[],
    private readonly subtitle: string,
  ) {
    super();
    this.searchMetadata = searchQuery.metadata ?? {};
  }

  getSearchQueryMetadata(): SingleGenreMetadata {
    return this.searchMetadata;
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genre",
          subtitle: this.subtitle,
          value: this.searchMetadata.genres ?? [],
          minItemCount: 0,
          maxItemCount: 1,
          options: this.genres.map(({ id, title }) => ({ id, title })),
          onValueChange: Application.Selector(this as SingleGenreSearchForm, "handleGenresChange"),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.searchMetadata.genres = value;
  }
}
