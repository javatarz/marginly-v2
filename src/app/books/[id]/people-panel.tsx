"use client";

import { useEffect, useRef } from "react";

import type { Person } from "@/lib/books/people-list";
import { showsGrantForm, showsRevokeButton } from "@/lib/books/people-panel-visibility";

import { grantAccess } from "./grant-access-action";
import styles from "./people-panel.module.css";
import { revokeAccess } from "./revoke-access-action";

/**
 * ADR-0011: a People act opens a panel listing the Author and every unrevoked
 * Reviewer. Both roles reach it; only the Author gets the grant field and a revoke
 * beside each Reviewer. Shaped like RenameDialog — a dialog a failed grant reopens on
 * load, carrying its problem in the URL the same way a failed rename does.
 */
export function PeoplePanel({
  bookId,
  isAuthor,
  people,
  problemMessage,
}: {
  bookId: string;
  isAuthor: boolean;
  people: readonly Person[];
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
        People
      </button>

      <dialog ref={dialogRef} className={styles.dialog}>
        <ul className={styles.list}>
          {people.map((person) => (
            <li key={person.id} className={styles.row}>
              <span className={styles.email}>{person.email}</span>
              <span className={styles.role}>
                {person.role === "author" ? "Author" : "Reviewer"}
              </span>

              {showsRevokeButton(isAuthor, person) ? (
                <form action={revokeAccess.bind(null, bookId, person.id)}>
                  <button type="submit" className={styles.revoke}>
                    Revoke
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>

        {showsGrantForm(isAuthor) ? (
          <form action={grantAccess.bind(null, bookId)} className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="grant-access-email" className={styles.label}>
                Grant access
              </label>
              <input
                id="grant-access-email"
                name="email"
                type="email"
                required
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
                Close
              </button>
              <button type="submit" className={styles.button}>
                Grant
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
