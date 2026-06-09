"use client";

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself.
 * Next.js renders this in place of the root layout, so it must provide
 * its own <html>/<body>. Kept dependency-light and inline-styled so it
 * works even if the shared chrome or stylesheet failed to load.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="mn">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9fafb",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#111827",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            maxWidth: "420px",
            width: "100%",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px" }}>
            Алдаа гарлаа
          </h1>
          <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 24px" }}>
            Системд гэнэтийн алдаа гарлаа. Хуудсыг дахин ачаална уу.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              padding: "9px 18px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Дахин ачаалах
          </button>
        </div>
      </body>
    </html>
  );
}
