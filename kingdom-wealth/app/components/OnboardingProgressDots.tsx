"use client";

type OnboardingStep = "Profile" | "Household" | "Invite" | "Accounts" | "Review" | "Loans";

export default function OnboardingProgressDots({
  currentStep,
  userRole = "",
}: {
  currentStep: OnboardingStep;
  userRole?: string;
}) {
  const steps = ["Profile", "Household", userRole === "admin" ? "Invite" : null, "Accounts", "Loans", "Review"].filter(Boolean) as string[];
  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="mb-4 w-full">
      {/* Dots row — full width, dots spread edge to edge */}
      <div className="flex w-full items-center justify-between">
        {steps.map((step, i, arr) => {
          const isCurrent = step === currentStep;
          const isCompleted = i < currentIndex;
          return (
            <div key={String(step)} className="flex flex-1 items-center">
              {/* Dot + label group */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold sm:h-9 sm:w-9 sm:text-sm ${
                    isCurrent
                      ? "bg-kw-gold text-white"
                      : isCompleted
                      ? "bg-kw-navy text-white"
                      : "bg-kw-border text-kw-muted"
                  }`}
                >
                  {isCompleted ? "✓" : i + 1}
                </div>

                {/* Label — centered below dot, hidden on mobile */}
                <span
                  className={`hidden text-[9px] font-semibold sm:inline sm:text-[10px] ${
                    isCurrent ? "text-kw-gold" : "text-kw-muted"
                  }`}
                >
                  {step}
                </span>
              </div>

              {/* Connector — between groups, takes remaining space */}
              {i < arr.length - 1 && (
                <div className="h-0.5 flex-1 bg-[#E4E8F0] [min-width:12px]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Current step label — mobile only */}
      <p className="mt-2 text-[10px] font-semibold text-kw-gold sm:hidden">
        Step {currentIndex + 1} of {steps.length} — {currentStep}
      </p>
    </div>
  );
}
