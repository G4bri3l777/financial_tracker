"use client";

import React from "react";

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
      <div className="flex w-full items-center">
        {steps.map((step, i, arr) => {
          const isCurrent = step === currentStep;
          const isCompleted = i < currentIndex;
          return (
            <React.Fragment key={String(step)}>
              {/* Dot + label — does NOT grow */}
              <div className="flex flex-col items-center gap-1 shrink-0">
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
                <span
                  className={`hidden text-[9px] font-semibold sm:inline sm:text-[10px] ${
                    isCurrent ? "text-kw-gold" : "text-kw-muted"
                  }`}
                >
                  {step}
                </span>
              </div>

              {/* Connector line — flex-1 so it fills space BETWEEN dots */}
              {i < arr.length - 1 && (
                <div className="h-0.5 flex-1 bg-[#E4E8F0] min-w-[8px]" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] font-semibold text-kw-gold sm:hidden">
        Step {currentIndex + 1} of {steps.length} — {currentStep}
      </p>
    </div>
  );
}
