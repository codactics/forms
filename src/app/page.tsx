import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";
import { CreateFormButton } from "@/components/forms/CreateFormButton";

export default async function Home() {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-royal-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <a
            href="https://www.codactics.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:underline"
          >
            <Image
              src="/logo/codactics.png"
              alt="Codactis logo"
              width={20}
              height={20}
              className="rounded"
            />
            CODACTICS
          </a>
          <div className="flex-1" />
          {isLoggedIn ? (
            <UserMenu />
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-royal-200 px-4 py-1.5 text-xs font-medium text-royal-600 hover:bg-royal-50"
            >
              Login
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24">
        <Image
          src="/logo/codactics.gif"
          alt="Codactis logo"
          width={96}
          height={96}
          unoptimized
          priority
          className="rounded-2xl"
        />

        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-royal-950 sm:text-4xl">
            Codactis Form Builder
          </h1>
          <p className="max-w-md text-royal-700">
            Build and publish tournament registration forms in minutes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <CreateFormButton className="inline-flex h-14 items-center justify-center rounded-full bg-royal-600 px-8 text-base font-medium text-white shadow-lg shadow-royal-600/30 transition-colors hover:bg-royal-700 disabled:cursor-not-allowed disabled:opacity-60">
              Create a new form
            </CreateFormButton>
          ) : (
            <Link
              href="/admin/new"
              className="inline-flex h-14 items-center justify-center rounded-full bg-royal-600 px-8 text-base font-medium text-white shadow-lg shadow-royal-600/30 transition-colors hover:bg-royal-700"
            >
              Create a new form
            </Link>
          )}
          {isLoggedIn && (
            <Link
              href="/admin/forms"
              className="inline-flex h-14 items-center justify-center rounded-full border border-royal-200 bg-white px-8 text-base font-medium text-royal-700 transition-colors hover:bg-royal-50"
            >
              Manage forms
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
