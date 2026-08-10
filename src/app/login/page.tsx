import Image from "next/image";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // Only accept relative, in-app paths — never redirect somewhere else
  // just because a query string asked for it.
  const redirectTo =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24">
      <Image
        src="/logo/codactics.png"
        alt="Codactis logo"
        width={72}
        height={72}
        priority
        className="rounded-2xl"
      />

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-royal-950">
          Sign in to Codactis
        </h1>
        <p className="max-w-sm text-sm text-royal-600">
          We use your Google account to save your forms and write
          submissions straight to a spreadsheet in your own Google Drive —
          nothing is stored on our servers beyond your form design.
        </p>
      </div>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo });
        }}
      >
        <button
          type="submit"
          className="flex h-12 items-center gap-3 rounded-full bg-royal-600 px-6 text-sm font-medium text-white shadow-lg shadow-royal-600/30 transition-colors hover:bg-royal-700"
        >
          <GoogleIcon />
          Sign in with Google
        </button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#fff"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z"
      />
      <path
        fill="#fff"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#fff"
        opacity=".7"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.16.29-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03z"
      />
      <path
        fill="#fff"
        opacity=".9"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}
