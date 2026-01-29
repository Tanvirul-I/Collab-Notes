import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Collab Notes",
  description: "Core note-taking app with authentication"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="container">
            <Link href="/" className="header-logo">Collab Notes</Link>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
