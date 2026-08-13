"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  type ConfirmOutcome,
  describeUploadError,
  type PreviewOutcome,
} from "@/lib/books/upload-response";
import { createClient } from "@/lib/supabase/browser";

import styles from "./upload-form.module.css";

type Preview = {
  readonly bookName: string;
  readonly segments: readonly string[];
  readonly removedTagCount: number;
};

type Status =
  | { kind: "idle" }
  | { kind: "staging" }
  | { kind: "preview"; preview: Preview }
  | { kind: "confirming"; preview: Preview }
  | { kind: "error"; message: string; preview: Preview | null }
  | { kind: "done"; versionNumber: number };

/**
 * The Upload act (#26, ADR-0008/ADR-0009/ADR-0015): the Author stages a zip, previews
 * what it would land — the Book's name and the first twenty segments of its text — and
 * only their own confirm turns it into a Version. One indeterminate loader covers the
 * whole wait; a determinate transfer bar is deliberately not built. Cancelling at the
 * preview calls nothing further, so it creates no Version, and a failed confirm leaves
 * the preview standing so the Author can retry it directly.
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

    setStatus({ kind: "staging" });
    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from("staging")
      .upload(`${bookId}/upload.zip`, file, { upsert: true });

    if (uploadError) {
      setStatus({
        kind: "error",
        message: "Could not upload the zip. Try again.",
        preview: null,
      });
      return;
    }

    const { data, error: invokeError } = await supabase.functions.invoke<PreviewOutcome>(
      "upload-preview",
      { body: { bookId } },
    );

    if (invokeError) {
      setStatus({
        kind: "error",
        message: await describeUploadError(invokeError),
        preview: null,
      });
      return;
    }

    if (!data || !data.ok) {
      setStatus({
        kind: "error",
        message: data && !data.ok ? data.message : "Could not preview the Upload.",
        preview: null,
      });
      return;
    }

    setStatus({
      kind: "preview",
      preview: {
        bookName: data.bookName,
        segments: data.segments,
        removedTagCount: data.removedTagCount,
      },
    });
  }

  async function handleConfirm(preview: Preview) {
    setStatus({ kind: "confirming", preview });
    const supabase = createClient();

    const { data, error: invokeError } = await supabase.functions.invoke<ConfirmOutcome>(
      "upload-confirm",
      { body: { bookId } },
    );

    if (invokeError) {
      setStatus({ kind: "error", message: await describeUploadError(invokeError), preview });
      return;
    }

    if (!data || !data.ok) {
      setStatus({
        kind: "error",
        message: data && !data.ok ? data.message : "Could not create the Version.",
        preview,
      });
      return;
    }

    setStatus({ kind: "done", versionNumber: data.versionNumber });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    router.refresh();
  }

  function handleCancel() {
    setStatus({ kind: "idle" });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const preview = status.kind === "preview" || status.kind === "confirming"
    ? status.preview
    : status.kind === "error"
    ? status.preview
    : null;

  if (preview) {
    const confirming = status.kind === "confirming";

    return (
      <div className={styles.preview}>
        <p className={styles.previewName}>Landing on: {preview.bookName}</p>
        <ol className={styles.segments}>
          {preview.segments.map((segment, index) => (
            <li key={index} className={styles.segment}>{segment}</li>
          ))}
        </ol>
        <p className={styles.removed}>{removedTagMessage(preview.removedTagCount)}</p>

        {status.kind === "error" ? (
          <p role="alert" className={styles.alert}>{status.message}</p>
        ) : null}

        <div className={styles.row}>
          <button
            type="button"
            className={styles.cancel}
            onClick={handleCancel}
            disabled={confirming}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => handleConfirm(preview)}
            disabled={confirming}
          >
            {confirming ? "Confirming…" : "Confirm"}
          </button>
        </div>
      </div>
    );
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
          disabled={status.kind === "staging"}
          className={styles.button}
        >
          {status.kind === "staging" ? "Previewing…" : "Upload"}
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

function removedTagMessage(count: number): string {
  if (count === 0) {
    return "No tags were removed.";
  }
  return count === 1 ? "1 tag was removed." : `${count} tags were removed.`;
}
