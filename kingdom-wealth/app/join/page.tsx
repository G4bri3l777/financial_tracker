"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  arrayUnion,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";
import { registerUser } from "@/app/lib/auth";
import { useAuth } from "../hooks/useAuth";

type InviteStatus = "loading" | "invalid" | "used" | "expired" | "valid";

function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("loading");
  const [inviteCode, setInviteCode] = useState("");
  const [householdId, setHouseholdId] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [inviterName, setInviterName] = useState("Someone");
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const codeFromUrl = useMemo(
    () => (searchParams.get("code") || "").trim().toUpperCase(),
    [searchParams],
  );

  useEffect(() => {
    const loadInvite = async () => {
      if (!codeFromUrl) {
        setInviteStatus("invalid");
        return;
      }

      setInviteStatus("loading");
      setError("");

      try {
        const inviteRef = doc(db, "invites", codeFromUrl);
        const inviteSnap = await getDoc(inviteRef);

        if (!inviteSnap.exists()) {
          setInviteStatus("invalid");
          return;
        }

        const inviteData = inviteSnap.data();
        if (inviteData.used === true) {
          setInviteStatus("used");
          return;
        }

        const expiresAt = inviteData.expiresAt as Timestamp | undefined;
        if (expiresAt && expiresAt.toDate().getTime() < Date.now()) {
          setInviteStatus("expired");
          return;
        }

        const foundHouseholdId =
          typeof inviteData.householdId === "string" ? inviteData.householdId : "";
        if (!foundHouseholdId) {
          setInviteStatus("invalid");
          return;
        }

        const householdSnap = await getDoc(doc(db, "households", foundHouseholdId));
        if (!householdSnap.exists()) {
          setInviteStatus("invalid");
          return;
        }

        const householdData = householdSnap.data();
        setHouseholdName(
          typeof householdData.name === "string" ? householdData.name : "this household",
        );
        setHouseholdId(foundHouseholdId);
        setInviteCode(codeFromUrl);

        if (typeof inviteData.createdBy === "string") {
          const inviterSnap = await getDoc(doc(db, "users", inviteData.createdBy));
          if (inviterSnap.exists()) {
            const inviterData = inviterSnap.data();
            const possibleName =
              (typeof inviterData.firstName === "string" && inviterData.firstName) ||
              (typeof inviterData.displayName === "string" && inviterData.displayName);
            if (possibleName) {
              setInviterName(possibleName);
            }
          }
        }

        setInviteStatus("valid");
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Could not validate invite link.";
        setError(message);
        setInviteStatus("invalid");
      }
    };

    void loadInvite();
  }, [codeFromUrl]);

  const errorMessageByStatus: Record<Exclude<InviteStatus, "loading" | "valid">, string> = {
    invalid: "This invite link is invalid.",
    used: "This invite link has already been used.",
    expired: "This invite link has expired.",
  };

  const completeJoinTransaction = async (
    uid: string,
    userFields: Record<string, unknown>,
  ) => {
    await runTransaction(db, async (transaction) => {
      const inviteRef = doc(db, "invites", inviteCode);
      const householdRef = doc(db, "households", householdId);
      const userRef = doc(db, "users", uid);

      const inviteSnap = await transaction.get(inviteRef);
      if (!inviteSnap.exists()) {
        throw new Error("This invite link is invalid.");
      }

      const inviteData = inviteSnap.data();
      if (inviteData.used === true) {
        throw new Error("This invite link has already been used.");
      }

      const expiresAt = inviteData.expiresAt as Timestamp | undefined;
      if (expiresAt && expiresAt.toDate().getTime() < Date.now()) {
        throw new Error("This invite link has expired.");
      }

      transaction.update(householdRef, {
        members: arrayUnion(uid),
      });
      transaction.set(userRef, userFields, { merge: true });
      transaction.update(inviteRef, {
        used: true,
        usedBy: uid,
        usedAt: serverTimestamp(),
      });
    });
  };

  const handleJoinLoggedIn = async () => {
    if (!user) {
      return;
    }

    setError("");

    try {
      setSubmitting(true);
      await completeJoinTransaction(user.uid, {
        householdId,
        role: "member",
        onboardingStep: "complete",
      });
      router.push("/dashboard");
    } catch (joinError) {
      const message =
        joinError instanceof Error ? joinError.message : "Could not join household.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterAndJoin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);

      const newUser = await registerUser(email, password, firstName, lastName, {
        skipUserDocument: true,
      });

      await completeJoinTransaction(newUser.uid, {
        uid: newUser.uid,
        email: newUser.email,
        displayName: `${firstName} ${lastName}`.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        householdId,
        role: "member",
        onboardingStep: "profile",
        createdAt: serverTimestamp(),
      });

      router.push("/onboarding/profile");
    } catch (joinError) {
      const message =
        joinError instanceof Error ? joinError.message : "Could not complete invite join.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <main className="space-y-6 md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <header className="space-y-2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
              Kingdom Wealth
            </p>
            <h1 className="text-3xl font-bold">You&apos;ve been invited to Kingdom Wealth</h1>
          </header>

          {inviteStatus === "loading" || authLoading ? (
            <p className="text-center text-sm text-[#1B2A4A]/70">Validating invite...</p>
          ) : null}

          {inviteStatus === "valid" ? (
            <section className="space-y-4">
              <p className="rounded-xl bg-[#F4F6FA] p-4 text-center text-sm md:text-base">
                {inviterName} has invited you to join{" "}
                <span className="font-semibold">{householdName}</span>
              </p>

              {user ? (
                <button
                  type="button"
                  onClick={handleJoinLoggedIn}
                  disabled={submitting}
                  className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
                >
                  {submitting ? "Joining..." : "Join Household"}
                </button>
              ) : (
                <form onSubmit={handleRegisterAndJoin} className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">First name</span>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      required
                      className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Last name</span>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      required
                      className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">Confirm password</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                      className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
                  >
                    {submitting ? "Joining..." : "Join Kingdom Wealth"}
                  </button>

                  <p className="text-center text-sm">
                    Already have an account?{" "}
                    <Link href="/login" className="font-semibold underline">
                      Sign in
                    </Link>
                  </p>
                </form>
              )}
            </section>
          ) : null}

          {inviteStatus !== "loading" && inviteStatus !== "valid" ? (
            <p className="text-sm font-medium text-red-600">
              {errorMessageByStatus[inviteStatus]}
            </p>
          ) : null}

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

          <footer className="pt-2 text-center text-xs italic text-[#C9A84C]">
            &quot;My God will supply all your needs&quot; — Phil 4:19
          </footer>
        </main>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-md">Loading...</div>
        </div>
      }
    >
      <JoinPageContent />
    </Suspense>
  );
}
