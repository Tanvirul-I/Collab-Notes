import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getSessionUser();
  
  if (user) {
    redirect("/app/documents");
  }

  return (
    <div className="card">
      <p>Welcome to Collab Notes. Please sign in to manage your documents.</p>
      <div className="nav-actions">
        <Link className="button" href="/login">
          Login
        </Link>
        <Link className="button secondary" href="/signup">
          Sign up
        </Link>
      </div>
    </div>
  );
}
