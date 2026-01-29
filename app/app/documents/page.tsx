"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Document = {
  id: string;
  title: string;
  updatedAt: string;
  isOwner?: boolean;
  permission?: string;
  sharedBy?: { name: string; email: string };
};

export default function DocumentsDashboard() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<Document[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  async function loadDocuments() {
    const response = await fetch("/api/documents", { cache: "no-store" });
    if (!response.ok) {
      setError("Unable to load documents");
      return;
    }

    const payload = await response.json();
    setDocuments(payload.documents ?? []);
    setSharedDocuments(payload.sharedDocuments ?? []);
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Could not create document");
      return;
    }

    setTitle("");
    await loadDocuments();
  }

  return (
    <div className="card">
      <div className="nav-actions">
        <h2>Your documents</h2>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form className="form-grid" onSubmit={handleCreate}>
        <div>
          <label htmlFor="title">Title</label>
          <input
            id="title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>
        <button className="button" type="submit">
          New document
        </button>
      </form>

      <div className="list">
        {documents.map((document) => (
          <div key={document.id} className="list-item">
            <div>
              <strong>{document.title}</strong>
              <p>Updated {new Date(document.updatedAt).toLocaleString()}</p>
            </div>
            <Link className="button secondary" href={`/app/documents/${document.id}`}>
              Open
            </Link>
          </div>
        ))}
        {documents.length === 0 ? <p>No documents yet</p> : null}
      </div>

      {sharedDocuments.length > 0 ? (
        <>
          <div className="nav-actions" style={{ marginTop: "2rem" }}>
            <h2>Shared with me</h2>
          </div>
          <div className="list">
            {sharedDocuments.map((document) => (
              <div key={document.id} className="list-item">
                <div>
                  <strong>{document.title}</strong>
                  <p>
                    Shared by {document.sharedBy?.name ?? document.sharedBy?.email}
                    {" · "}
                    {document.permission === "editor" ? "Can edit" : "View only"}
                  </p>
                  <p>Updated {new Date(document.updatedAt).toLocaleString()}</p>
                </div>
                <Link className="button secondary" href={`/app/documents/${document.id}`}>
                  Open
                </Link>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
