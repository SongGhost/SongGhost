import type { Metadata } from "next";
import { verifyAdminAccess } from "@/lib/admin";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SongHost Studio Ops",
  robots: { index: false, follow: false },
};

function AdminNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#09090b] px-6 text-center text-zinc-100">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">
        Error
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50">
        404 Not Found
      </h1>
      <p className="mt-3 max-w-sm text-sm text-zinc-400">
        This page does not exist.
      </p>
    </div>
  );
}

/**
 * Owner admin console. Unauthorized visitors see a clean 404 so the route
 * stays invisible to standard listeners.
 */
export default async function AdminPage() {
  const isAdmin = await verifyAdminAccess();
  if (!isAdmin) {
    return <AdminNotFound />;
  }

  return <AdminDashboard />;
}
