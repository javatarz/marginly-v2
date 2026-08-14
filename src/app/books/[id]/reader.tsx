"use client";

import { useEffect, useRef, useState } from "react";

import type { Person } from "@/lib/books/people-list";
import { shouldFollowLatestVersion } from "@/lib/reading/follow-latest";

import { PeoplePanel } from "./people-panel";
import { RenameDialog } from "./rename-dialog";
import { ThreadsMargin } from "./threads/threads-margin";
import { ThreadsOverlay } from "./threads/threads-overlay";
import { useThreadsLayer } from "./threads/use-threads-layer";
import { UploadForm } from "./upload-form";
import pageStyles from "./page.module.css";
import styles from "./reader.module.css";

export type VersionSummary = {
  versionNumber: number;
  createdAt: string;
};

type SwitchState = { kind: "idle" } | { kind: "loading" } | { kind: "error" };

/**
 * The reading view (ADR-0007, ADR-0011, ADR-0012): the Book's name, the Version
 * switcher and the Book's acts sit in one header above the Version's own content, with
 * no iframe and no shadow root — the Book is a fragment of this same document.
 *
 * Switching Versions is a client-side fetch (`/books/:id/versions/:n`), never a
 * navigation: the Book keeps one address (ADR-0011), so there is nothing in the URL to
 * change. A reload always comes back through the Server Component and lands on
 * `initialVersionNumber` again, which the page always resolves to latest.
 *
 * A missing asset is not decided here or in Storage — the browser already reports it
 * for free as an `error` event on the `<img>` it could not load (`srcset`/`<picture>`
 * candidates that 404 fail the same way once the browser has picked one). `error`
 * does not bubble, so this listens in the capture phase on the content container,
 * which still sees it on the way down, and swaps the broken image for a message.
 */
export function Reader({
  bookId,
  bookName,
  bookAuthorId,
  currentUserId,
  isAuthor,
  versions,
  latestVersionNumber,
  initialVersionNumber,
  initialHtml,
  renameMessage,
  people,
  peopleMessage,
}: {
  bookId: string;
  bookName: string;
  bookAuthorId: string;
  currentUserId: string;
  isAuthor: boolean;
  versions: readonly VersionSummary[];
  latestVersionNumber: number;
  initialVersionNumber: number;
  initialHtml: string;
  renameMessage?: string;
  people: readonly Person[];
  peopleMessage?: string;
}) {
  const [versionNumber, setVersionNumber] = useState(initialVersionNumber);
  const [html, setHtml] = useState(initialHtml);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switchState, setSwitchState] = useState<SwitchState>({ kind: "idle" });
  const contentRef = useRef<HTMLDivElement>(null);

  const threadsLayer = useThreadsLayer({
    bookId,
    versionNumber,
    isLatest: versionNumber === latestVersionNumber,
    contentRef,
  });

  const versionNumberRef = useRef(versionNumber);
  useEffect(() => {
    versionNumberRef.current = versionNumber;
  }, [versionNumber]);

  // Upload always lands as the next Version after the latest (ADR-0011). `router.refresh()`
  // (upload-form.tsx) re-renders the Server Component with a new `latestVersionNumber` and
  // `initialHtml`, but this component's own state does not pick up new props on its own —
  // so a reader following the latest Version stays on it as it moves; a reader who had
  // switched away to an older Version stays exactly where they were, same as any other
  // Upload while reading an older Version.
  const previousLatestVersionNumberRef = useRef(latestVersionNumber);
  useEffect(() => {
    const previousLatest = previousLatestVersionNumberRef.current;
    previousLatestVersionNumberRef.current = latestVersionNumber;

    if (
      shouldFollowLatestVersion({
        currentVersionNumber: versionNumberRef.current,
        previousLatestVersionNumber: previousLatest,
        nextLatestVersionNumber: latestVersionNumber,
      })
    ) {
      setVersionNumber(latestVersionNumber);
      setHtml(initialHtml);
    }
  }, [latestVersionNumber, initialHtml]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }

    function handleAssetError(event: Event) {
      if (!(event.target instanceof HTMLImageElement)) {
        return;
      }

      const placeholder = document.createElement("span");
      placeholder.className = styles.missingAsset ?? "";
      placeholder.textContent = "This image cannot be rendered.";
      event.target.replaceWith(placeholder);
    }

    container.addEventListener("error", handleAssetError, true);
    return () => container.removeEventListener("error", handleAssetError, true);
  }, [html]);

  async function selectVersion(next: number) {
    setSwitcherOpen(false);
    if (next === versionNumber) {
      return;
    }

    setSwitchState({ kind: "loading" });
    try {
      const response = await fetch(`/books/${bookId}/versions/${next}`);
      if (!response.ok) {
        setSwitchState({ kind: "error" });
        return;
      }

      const data: { html: string; versionNumber: number } = await response.json();
      setHtml(data.html);
      setVersionNumber(data.versionNumber);
      setSwitchState({ kind: "idle" });
    } catch {
      setSwitchState({ kind: "error" });
    }
  }

  return (
    <>
      <header className={pageStyles.header}>
        <h1 className={pageStyles.name}>{bookName}</h1>

        <div className={styles.switcherWrapper}>
          <button
            type="button"
            className={styles.switcherButton}
            aria-expanded={switcherOpen}
            onClick={() => setSwitcherOpen((open) => !open)}
          >
            Version {versionNumber}
          </button>

          {switcherOpen ? (
            <ul className={styles.switcherPanel}>
              {versions.map((version) => (
                <li key={version.versionNumber}>
                  <button
                    type="button"
                    className={
                      version.versionNumber === versionNumber
                        ? `${styles.versionItem} ${styles.versionItemActive}`
                        : styles.versionItem
                    }
                    onClick={() => selectVersion(version.versionNumber)}
                  >
                    <span className={styles.versionNumber}>Version {version.versionNumber}</span>
                    <span className={styles.versionDate}>{formatUploadDate(version.createdAt)}</span>
                    {version.versionNumber === latestVersionNumber ? (
                      <span className={styles.latestBadge}>Latest</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {switchState.kind === "error" ? (
          <p role="alert" className={styles.switchError}>
            Could not switch Versions. Try again.
          </p>
        ) : null}

        <div className={pageStyles.actions}>
          <PeoplePanel
            bookId={bookId}
            isAuthor={isAuthor}
            people={people}
            problemMessage={peopleMessage}
          />

          {isAuthor ? (
            <RenameDialog bookId={bookId} currentName={bookName} problemMessage={renameMessage} />
          ) : null}
        </div>
      </header>

      <main className={styles.page}>
        {isAuthor ? <UploadForm bookId={bookId} /> : null}

        <div className={styles.layout}>
          <div className={styles.readingColumn}>
            <div
              ref={contentRef}
              className={styles.reading}
              // The stored HTML is already sanitised at Upload time (ADR-0005) and never
              // carries an Author stylesheet (ADR-0012) — this only injects the rewritten
              // markup, it does not sanitise it again.
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <ThreadsOverlay state={threadsLayer} />
          </div>

          <ThreadsMargin state={threadsLayer} bookAuthorId={bookAuthorId} currentUserId={currentUserId} />
        </div>
      </main>
    </>
  );
}

function formatUploadDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
