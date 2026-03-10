import Link from "next/link";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8 md:bg-[#F4F6FA]">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 hidden flex-col items-center text-center md:flex">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
            Kingdom Wealth
          </p>
          <h1 className="mt-2 text-3xl font-bold">Create your account</h1>
        </div>

        <main className="md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <header className="mb-8 space-y-2 md:mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C] md:hidden">
              Kingdom Wealth
            </p>
            <h2 className="text-3xl font-bold md:text-2xl">Create your account</h2>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              Start building wealth together with clear goals and shared visibility.
            </p>
          </header>

          <form className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">First name</span>
                <input
                  type="text"
                  name="firstName"
                  autoComplete="given-name"
                  placeholder="John"
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Last name</span>
                <input
                  type="text"
                  name="lastName"
                  autoComplete="family-name"
                  placeholder="Doe"
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </label>
            </div>

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
                autoComplete="new-password"
                placeholder="At least 8 characters"
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Confirm password</span>
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="Re-enter password"
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            <label className="flex items-start gap-2 rounded-xl border border-[#1B2A4A]/10 bg-[#F4F6FA] p-3">
              <input
                type="checkbox"
                name="terms"
                className="mt-0.5 h-4 w-4 rounded border-[#1B2A4A]/30 accent-[#C9A84C]"
              />
              <span className="text-sm text-[#1B2A4A]/85">
                I agree to Terms of Service
              </span>
            </label>

            <button
              type="button"
              className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
            >
              Create Account
            </button>
          </form>

          <footer className="pt-6 text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[#1B2A4A] underline">
              Log in
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
