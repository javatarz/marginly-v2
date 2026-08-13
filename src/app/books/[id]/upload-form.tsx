"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { describeUploadError, type UploadOutcome } from "@/lib/books/upload-response";
import { createClient } from "@/lib/supabase/browser";

import styles from "./upload-form.module.css";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "error"; message: string }
  | { kind: "done"; versionNumber: number };

/**
 * The Author picks a zip and a Version comes into existence (#25), straight through:
 * no preview, no confirm — #26 inserts that step later. ADR-0009/ADR-0015: the browser
 * puts the zip at the Book's staging prefix itself and the Edge Function receives a
 * path, not a body, so this uploads to Storage directly rather than posting the file
 * through a Server Action.
 */
export function UploadForm({ bookId }: { bookId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      return;
    }

    setStatus({ kind: "uploading" });
    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from("staging")
      .upload(`${bookId}/upload.zip`, file, { upsert: true });

    if (uploadError) {
      setStatus({
        kind: "error",
        message: "Could not upload the zip. Try again.",
      });
      return;
    }

    const { data, error: invokeError } = await supabase.functions.invoke<
      UploadOutcome
    >("upload", { body: { bookId } });

    if (invokeError) {
      setStatus({ kind: "error", message: await describeUploadError(invokeError) });
      return;
    }

    if (!data || !data.ok) {
      setStatus({
        kind: "error",
        message: data && !data.ok ? data.message : "Could not create the Version.",
      });
      return;
    }

    setStatus({ kind: "done", versionNumber: data.versionNumber });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label htmlFor="upload-zip" className={styles.label}>
        Upload a zip holding index.html at its root
      </label>
      <div className={styles.row}>
        <input
          id="upload-zip"
          ref={inputRef}
          type="file"
          accept=".zip"
          required
          className={styles.input}
        />
        <button
          type="submit"
          disabled={status.kind === "uploading"}
          className={styles.button}
        >
          {status.kind === "uploading" ? "Uploading…" : "Upload"}
        </button>
      </div>

      {status.kind === "error" ? (
        <p role="alert" className={styles.alert}>
          {status.message}
        </p>
      ) : null}
      {status.kind === "done" ? (
        <p className={styles.success}>Version {status.versionNumber} landed.</p>
      ) : null}
    </form>
  );
}
