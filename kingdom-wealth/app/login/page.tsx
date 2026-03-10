import Link from "next/link";

export default function LoginPage() {
  const formContent = (
    <>
      <header className="mb-8 space-y-2 md:mb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C] md:hidden">
          Kingdom Wealth
        </p>
        <h2 className="text-3xl font-bold md:text-2xl">Welcome back</h2>
        <p className="text-sm text-[#1B2A4A]/75 md:text-base">
          Sign in to continue building wealth together.
        </p>
      </header>

      <form className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
          />
        </label>

        <div className="flex justify-end">
          <Link
            href="#"
            className="text-sm font-medium text-[#1B2A4A]/80 underline underline-offset-2"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
        >
          Sign In
        </button>
      </form>

      <footer className="pt-6 text-center text-sm">
        Need an account?{" "}
        <Link href="/register" className="font-semibold text-[#1B2A4A] underline">
          Create one
        </Link>
      </footer>
    </>
  );

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8 md:bg-[#F4F6FA]">
      <div className="mx-auto hidden w-full max-w-md md:block lg:hidden">
        <div className="mb-6 flex flex-col items-center text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
            Kingdom Wealth
          </p>
          <h1 className="mt-2 text-3xl font-bold">Welcome back</h1>
        </div>
        <main className="rounded-2xl bg-white p-8 shadow-xl">{formContent}</main>
      </div>

      <div className="mx-auto w-full max-w-md md:hidden">
        <main>{formContent}</main>
      </div>

      <div className="mx-auto hidden w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-xl lg:grid lg:min-h-[720px] lg:grid-cols-2">
        <section className="flex flex-col justify-center bg-[#C9A84C] p-12 text-[#1B2A4A]">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1B2A4A]/80">
            Kingdom Wealth
          </p>
          <h1 className="mt-4 text-5xl font-bold leading-tight">
            Build wealth together, on purpose.
          </h1>
          <ul className="mt-8 space-y-4 text-lg font-medium">
            <li>See everything together</li>
            <li>AI-powered insights</li>
            <li>Budget by agreement</li>
          </ul>
        </section>
        <section className="flex items-center justify-center p-10">
          <main className="w-full max-w-md">{formContent}</main>
        </section>
      </div>
    </div>
  );
}
