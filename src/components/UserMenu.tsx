"use client";

import Image from "next/image";
import { useSession, signOut } from "next-auth/react";

export function UserMenu() {
  const { data: session } = useSession();
  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-2">
      {session.user.image && (
        <Image
          src={session.user.image}
          alt={session.user.name ?? "Account"}
          width={28}
          height={28}
          className="rounded-full"
        />
      )}
      <span className="hidden max-w-[140px] truncate text-xs font-medium text-royal-700 sm:inline">
        {session.user.name ?? session.user.email}
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="rounded-full border border-royal-200 px-3 py-1.5 text-xs font-medium text-royal-600 hover:bg-royal-50"
      >
        Sign out
      </button>
    </div>
  );
}
