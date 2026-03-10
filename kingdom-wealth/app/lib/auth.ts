import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export async function registerUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const displayName = `${firstName} ${lastName}`.trim();

  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }

  await setDoc(doc(db, "users", credential.user.uid), {
    uid: credential.user.uid,
    email: credential.user.email,
    displayName: displayName || null,
    onboardingStep: "profile",
    createdAt: serverTimestamp(),
    householdId: null,
    role: null,
  });

  return credential.user;
}

export async function loginUser(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export async function resetPassword(email: string, redirectUrl?: string) {
  if (redirectUrl) {
    await sendPasswordResetEmail(auth, email, {
      url: redirectUrl,
      handleCodeInApp: false,
    });
    return;
  }

  await sendPasswordResetEmail(auth, email);
}
