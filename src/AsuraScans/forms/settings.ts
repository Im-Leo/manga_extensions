/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
  type FormSectionElement,
} from "@paperback/types";

import type { AsuraUser } from "../models";
import * as session from "../session";
import { clearCachedTags } from "../tags";

const SHOW_UPCOMING_KEY = "prerelease";

export function getShowUpcomingChapters(): boolean {
  return Application.getState(SHOW_UPCOMING_KEY) === "true";
}

function setShowUpcomingChapters(value: boolean): void {
  Application.setState(value.toString(), SHOW_UPCOMING_KEY);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Account and preferences.
 *
 * The credentials live only in this form while it is open: they are sent once,
 * when Sign In is tapped, and only the resulting tokens are stored.
 */
export class AsuraSettingForm extends Form {
  private email = "";
  private password = "";
  private signInError?: string;
  private signingIn = false;

  override getSections(): FormSectionElement<unknown>[] {
    return [
      session.isSignedIn() ? this.accountSection(session.currentUser()) : this.signInSection(),
      this.preferences(),
    ];
  }

  private accountSection(user: AsuraUser | undefined): FormSectionElement<unknown> {
    return Section({ id: "account", header: "Account" }, [
      LabelRow("user", {
        title: "Signed in as",
        value: user?.username ?? "AsuraScans account",
        subtitle: user?.email,
      }),
      ButtonRow("signOut", {
        title: "Sign Out",
        onSelect: Application.Selector(this as AsuraSettingForm, "signOut"),
      }),
    ]);
  }

  private signInSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "signIn",
        header: "Account",
        footer: "Signing in unlocks early access chapters and reading progress sync.",
      },
      [
        InputRow("email", {
          title: "Email",
          value: this.email,
          onValueChange: Application.Selector(this as AsuraSettingForm, "updateEmail"),
        }),
        InputRow("password", {
          title: "Password",
          value: this.password,
          isSecureEntry: true,
          onValueChange: Application.Selector(this as AsuraSettingForm, "updatePassword"),
        }),
        this.signInError
          ? LabelRow("signInError", { title: this.signInError, style: "error" })
          : undefined,
        ButtonRow("signIn", {
          title: this.signingIn ? "Signing In…" : "Sign In",
          onSelect: Application.Selector(this as AsuraSettingForm, "signIn"),
        }),
      ],
    );
  }

  private preferences(): FormSectionElement<unknown> {
    return Section({ id: "preferences", header: "Preferences" }, [
      ToggleRow("showUpcoming", {
        title: "Show Upcoming Chapters",
        value: getShowUpcomingChapters(),
        onValueChange: Application.Selector(this as AsuraSettingForm, "updateShowUpcoming"),
      }),
      ButtonRow("clearTags", {
        title: "Clear Cached Search Tags",
        onSelect: Application.Selector(this as AsuraSettingForm, "clearTags"),
      }),
    ]);
  }

  async updateEmail(value: string): Promise<void> {
    this.email = value.trim();
  }

  async updatePassword(value: string): Promise<void> {
    this.password = value;
  }

  async signIn(): Promise<void> {
    if (this.signingIn) return;
    this.signingIn = true;
    this.signInError = undefined;
    this.reloadForm();

    try {
      await session.signIn(this.email, this.password);
      this.password = "";
    } catch (error) {
      this.signInError = messageOf(error);
    } finally {
      this.signingIn = false;
      this.reloadForm();
    }
  }

  async signOut(): Promise<void> {
    session.signOut();
    this.reloadForm();
  }

  async updateShowUpcoming(value: boolean): Promise<void> {
    setShowUpcomingChapters(value);
  }

  async clearTags(): Promise<void> {
    clearCachedTags();
  }
}
