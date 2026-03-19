"use client";

type OnboardingStep = "Profile" | "Household" | "Invite" | "Accounts" | "Review" | "Loans";

export default function OnboardingProgressDots({
  currentStep,
  userRole = "",
}: {
  currentStep: OnboardingStep;
  userRole?: string;
}) {
  const steps = ["Profile", "Household", userRole === "admin" ? "Invite" : null, "Accounts", "Review", "Loans"].filter(Boolean) as string[];
  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="mb-4 flex items-center gap-2">
      {steps.map((step, i, arr) => {
        const isCurrent = step === currentStep;
        const isCompleted = i < currentIndex;
        return (
          <div key={String(step)} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                isCurrent ? "bg-[#C9A84C] text-white" : isCompleted ? "bg-[#1B2A4A] text-white" : "bg-[#E4E8F0] text-[#9AA5B4]"
              }`}
            >
              {isCompleted ? "✓" : i + 1}
            </div>
            <span className={`text-[10px] font-semibold ${isCurrent ? "text-[#C9A84C]" : "text-[#9AA5B4]"}`}>
              {step}
            </span>
            {i < arr.length - 1 && <div className="h-px w-6 bg-[#E4E8F0]" />}
          </div>
        );
      })}
    </div>
  );
}
