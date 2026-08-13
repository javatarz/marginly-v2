"use client";

import { useEffect, useRef } from "react";

import { renameBook } from "./rename-book-action";
import styles from "./rename-dialog.module.css";

/**
 * ADR-0011: rename opens a small dialog with the current name filled in — editing the
 * name in place was rejected because a rejected name has nowhere to be shown. This is the
 * one piece of the ticket that needs a client component: opening and closing the dialog
 * is a page-local decision no server round trip should be involved in.
 *
 * A failed rename still comes back the same way create's failures do — a full navigation
 * back to this page, carrying the problem in the URL — so a message present on load means
 * the dialog re-opens showing it, rather than the page opening as if nothing had been
 * attempted.
 */
export function RenameDialog({
  bookId,
  currentName,
  problemMessage,
}: {
  bookId: string;
  currentName: string;
  problemMessage?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (problemMessage) {
      dialogRef.current?.showModal();
    }
  }, [problemMessage]);

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => dialogRef.current?.showModal()}
      >
        Rename
      </button>

      <dialog ref={dialogRef} className={styles.dialog}>
        <form
          action={renameBook.bind(null, bookId)}
          className={styles.form}
        >
          <div className={styles.formRow}>
            <label htmlFor="rename-book-name" className={styles.label}>
              Rename the Book
            </label>
            <input
              id="rename-book-name"
              name="name"
              type="text"
              required
              defaultValue={currentName}
              className={styles.input}
            />
          </div>

          {problemMessage ? (
            <p role="alert" className={styles.alert}>
              {problemMessage}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className={styles.button}>
              Save
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
