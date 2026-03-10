import Link from "next/link";

export default function Home() {
  const valueCards = [
    "See Everything Together",
    "AI-Powered Insights",
    "Budget by Agreement",
  ];

  const steps = [
    "Sign Up",
    "Upload Documents",
    "Agree on Budget",
  ];

  return (
    <div className="min-h-screen bg-white text-[#1B2A4A]">
      <header className="hidden border-b border-[#1B2A4A]/10 md:block">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4 lg:px-8">
          <span className="text-lg font-bold">Kingdom Wealth</span>
          <div className="flex items-center gap-5 text-sm font-medium">
            <Link href="/" className="text-[#1B2A4A]">
              Home
            </Link>
            <Link href="/login" className="text-[#1B2A4A]/80 hover:text-[#1B2A4A]">
              Login
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-[#C9A84C] px-4 py-2 text-[#1B2A4A]"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 md:px-6 md:pt-12 lg:px-8 lg:pb-12">
        <section className="grid items-center gap-8 md:gap-10 lg:grid-cols-2">
          <div className="space-y-4 md:space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
              Financial Wellness for Couples
            </p>
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">
              Kingdom Wealth
            </h1>
            <p className="max-w-xl text-base text-[#1B2A4A]/80 md:text-lg">
              Build wealth together, on purpose.
            </p>
            <div className="flex justify-center md:justify-start">
              <Link
                href="/register"
                className="inline-flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95 md:w-auto md:px-7"
              >
                Get Started Free
              </Link>
            </div>
          </div>

          <div className="rounded-3xl bg-[#F4F6FA] p-6 ring-1 ring-[#1B2A4A]/5 md:p-8">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-[#1B2A4A]/70">Shared Progress</p>
              <div className="mt-3 h-3 w-full rounded-full bg-[#F4F6FA]">
                <div className="h-3 w-2/3 rounded-full bg-[#C9A84C]" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#F4F6FA] p-3">
                  <p className="text-xs text-[#1B2A4A]/70">Savings</p>
                  <p className="text-lg font-semibold">$12,400</p>
                </div>
                <div className="rounded-xl bg-[#F4F6FA] p-3">
                  <p className="text-xs text-[#1B2A4A]/70">Budget Health</p>
                  <p className="text-lg font-semibold">Strong</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 space-y-4 md:mt-14">
          <h2 className="text-xl font-semibold md:text-2xl">
            Why couples choose Kingdom Wealth
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {valueCards.map((card) => (
              <article
                key={card}
                className="rounded-2xl bg-[#F4F6FA] p-5 shadow-sm ring-1 ring-[#1B2A4A]/5"
              >
                <h3 className="text-base font-semibold md:text-lg">{card}</h3>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-4 md:mt-14">
          <h2 className="text-xl font-semibold md:text-2xl">How it works</h2>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-3 rounded-2xl bg-[#F4F6FA] p-4 ring-1 ring-[#1B2A4A]/5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#C9A84C] text-sm font-bold text-[#1B2A4A]">
                  {index + 1}
                </span>
                <span className="text-sm font-medium md:text-base">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex h-16 w-full max-w-md items-center justify-around border-t border-[#1B2A4A]/10 bg-white px-6 md:hidden">
        <Link
          href="/"
          className="flex flex-col items-center gap-1 text-xs font-medium text-[#1B2A4A]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
          </svg>
          Home
        </Link>
        <Link
          href="/login"
          className="flex flex-col items-center gap-1 text-xs font-medium text-[#1B2A4A]/80"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c2-4 5-6 8-6s6 2 8 6" />
          </svg>
          Login
        </Link>
      </nav>
    </div>
  );
}
