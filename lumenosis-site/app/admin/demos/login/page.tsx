import type { Metadata } from "next";

export const metadata: Metadata = { title: "Demo Admin", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0c0d] p-4 text-white">
      <form
        action="/api/admin/login"
        method="post"
        className="w-full max-w-sm rounded-[14px] bg-[#f8f7f3] p-8 text-[#151515] shadow-2xl"
      >
        <p className="text-sm font-semibold text-[#9b742e]">Lumenosis</p>
        <h1 className="mt-3 text-3xl font-semibold">Demo review</h1>
        <label className="mt-8 block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          inputMode="numeric"
          required
          className="mt-2 w-full rounded-[10px] border border-black/15 bg-white px-4 py-3 text-base outline-none focus:border-[#c49a52] focus:ring-2 focus:ring-[#c49a52]/20"
        />
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Incorrect password.
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-6 w-full rounded-[10px] bg-[#151515] px-4 py-3 font-semibold text-white active:scale-[0.98]"
        >
          Open demo queue
        </button>
      </form>
    </main>
  );
}
