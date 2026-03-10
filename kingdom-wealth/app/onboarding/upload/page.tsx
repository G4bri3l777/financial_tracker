"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useDocuments } from "@/app/hooks/useDocuments";
import { useMembers } from "@/app/hooks/useMembers";
import { db, storage } from "@/app/lib/firebase";

type UploadProgress = {
  fileName: string;
  progress: number;
  error: string | null;
};

function getDisplayName(firstName: string, lastName: string, displayName: string) {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || displayName || "Member";
}

function formatUploadedAt(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  return "Unknown time";
}

export default function OnboardingUploadPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdId, setHouseholdId] = useState("");
  const [currentUserName, setCurrentUserName] = useState("You");
  const [loadingContext, setLoadingContext] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [continuing, setContinuing] = useState(false);

  const documents = useDocuments(householdId || undefined);
  const members = useMembers(householdId || undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const loadContext = async () => {
      if (!user) {
        return;
      }

      setLoadingContext(true);
      setError("");

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data();

        if (!userData) {
          throw new Error("Could not find your user profile.");
        }

        if (userData.onboardingStep === "complete") {
          router.replace("/dashboard");
          return;
        }

        const foundHouseholdId =
          typeof userData.householdId === "string" ? userData.householdId : "";
        if (!foundHouseholdId) {
          throw new Error("Household not found. Please complete previous onboarding steps.");
        }

        const firstName = typeof userData.firstName === "string" ? userData.firstName : "";
        const lastName = typeof userData.lastName === "string" ? userData.lastName : "";
        const displayName =
          typeof userData.displayName === "string" ? userData.displayName : "Your";

        setCurrentUserName(getDisplayName(firstName, lastName, displayName));
        setHouseholdId(foundHouseholdId);
      } catch (contextError) {
        const message =
          contextError instanceof Error
            ? contextError.message
            : "Could not load upload context.";
        setError(message);
      } finally {
        setLoadingContext(false);
      }
    };

    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }

    if (!authLoading && user) {
      void loadContext();
    }
  }, [authLoading, user, router]);

  const memberNameByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(
        member.uid,
        getDisplayName(member.firstName, member.lastName, member.displayName),
      );
    }
    return map;
  }, [members]);

  const docsByAssignedMember = useMemo(() => {
    const grouped: Record<string, typeof documents> = {};
    for (const docItem of documents) {
      const assignedTo =
        typeof docItem.assignedTo === "string"
          ? docItem.assignedTo
          : typeof docItem.uploadedBy === "string"
            ? docItem.uploadedBy
            : "unassigned";
      if (!grouped[assignedTo]) {
        grouped[assignedTo] = [];
      }
      grouped[assignedTo].push(docItem);
    }
    return grouped;
  }, [documents]);

  const canContinue = useMemo(
    () => documents.some((docItem) => docItem.status === "uploaded"),
    [documents],
  );

  const spouseMember = useMemo(
    () => members.find((member) => member.uid !== user?.uid),
    [members, user?.uid],
  );

  async function uploadFile(file: File) {
    if (!householdId || !user) {
      throw new Error("Missing upload context.");
    }

    const lowerName = file.name.toLowerCase();

    // Detect content type
    let contentType = "application/octet-stream";
    if (lowerName.endsWith(".pdf")) contentType = "application/pdf";
    if (lowerName.endsWith(".csv")) contentType = "text/csv";

    // Upload to Firebase Storage
    const timestamp = Date.now();
    const ext = lowerName.endsWith(".pdf") ? ".pdf" : ".csv";
    const storagePath = `households/${householdId}/documents/${user.uid}/${timestamp}${ext}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType,
      customMetadata: {
        originalName: file.name,
        uploadedBy: user.uid,
      },
    });

    return { storagePath, storageRef };
  }

  const uploadSingleFile = async (file: File) => {
    if (!user || !householdId) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadProgress((prev) => ({
        ...prev,
        [file.name]: { fileName: file.name, progress: 0, error: "File exceeds 10MB." },
      }));
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".pdf")) {
      setUploadProgress((prev) => ({
        ...prev,
        [file.name]: { fileName: file.name, progress: 0, error: "Only CSV and PDF are supported." },
      }));
      return;
    }

    try {
      setUploadProgress((prev) => ({
        ...prev,
        [file.name]: { fileName: file.name, progress: 10, error: null },
      }));

      const { storagePath, storageRef } = await uploadFile(file);
      const fileType = lowerName.endsWith(".csv")
        ? "csv"
        : lowerName.endsWith(".pdf")
          ? "pdf"
          : "other";

      const docRef = doc(collection(db, "households", householdId, "documents"));
      await setDoc(docRef, {
        uploadedBy: user.uid,
        uploadedByName: currentUserName,
        assignedTo: user.uid,
        assignedToName: currentUserName,
        fileName: file.name,
        storagePath,
        fileType,
        note: "",
        downloadURL: null,
        status: "uploaded",
        parsedAt: null,
        transactionCount: 0,
        uploadedAt: serverTimestamp(),
      });

      // Use the exact same ref used for uploadBytes so Firebase handles encoding correctly.
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(docRef, { downloadURL });

      setUploadProgress((prev) => ({
        ...prev,
        [file.name]: { fileName: file.name, progress: 100, error: null },
      }));
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Upload failed.";
      setUploadProgress((prev) => ({
        ...prev,
        [file.name]: { fileName: file.name, progress: 0, error: message },
      }));
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) {
      return;
    }
    setError("");
    for (const file of Array.from(fileList)) {
      await uploadSingleFile(file);
    }
  };

  const updateDocumentField = async (docId: string, patch: Record<string, unknown>) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, "households", householdId, "documents", docId), {
        ...patch,
      });
    } catch (updateError) {
      const message =
        updateError instanceof Error ? updateError.message : "Could not update document.";
      setError(message);
    }
  };

  const deleteDocument = async (docId: string, storagePath: string) => {
    if (!householdId) {
      return;
    }

    try {
      if (storagePath) {
        try {
          await deleteObject(ref(storage, storagePath));
        } catch (storageError: unknown) {
          const storageCode =
            typeof storageError === "object" &&
            storageError !== null &&
            "code" in storageError
              ? String((storageError as { code?: string }).code)
              : "";
          if (storageCode !== "storage/object-not-found") {
            throw storageError;
          }
        }
      }

      await deleteDoc(doc(db, "households", householdId, "documents", docId));
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete document.";
      setError(message);
    }
  };

  const purgeOrphanedDocuments = async () => {
    if (!householdId) {
      return;
    }

    try {
      setError("");
      for (const docItem of documents) {
        const storagePath =
          typeof docItem.storagePath === "string" ? docItem.storagePath : "";
        if (!storagePath) {
          continue;
        }

        try {
          const freshURL = await getDownloadURL(ref(storage, storagePath));
          await updateDoc(doc(db, "households", householdId, "documents", docItem.id), {
            downloadURL: freshURL,
          });
        } catch (storageError: unknown) {
          const storageCode =
            typeof storageError === "object" &&
            storageError !== null &&
            "code" in storageError
              ? String((storageError as { code?: string }).code)
              : "";

          if (storageCode === "storage/object-not-found") {
            await deleteDoc(doc(db, "households", householdId, "documents", docItem.id));
          }
        }
      }
    } catch (purgeError) {
      const message =
        purgeError instanceof Error
          ? purgeError.message
          : "Could not sync documents. Please try again.";
      setError(message);
    }
  };

  const previewDocument = async (
    docId: string,
    downloadURL?: string,
    storagePath?: string,
  ) => {
    try {
      if (!storagePath || !householdId) {
        throw new Error("Document path is not available yet.");
      }

      // Always regenerate a fresh authenticated URL from storagePath
      // to avoid stale/malformed links saved previously.
      const freshURL = await getDownloadURL(ref(storage, storagePath));
      await updateDoc(doc(db, "households", householdId, "documents", docId), {
        downloadURL: freshURL,
      });

      window.open(freshURL, "_blank", "noopener,noreferrer");
    } catch (previewError) {
      const message =
        previewError instanceof Error ? previewError.message : "Could not open document preview.";
      setError(message);
    }
  };

  const continueToReview = async () => {
    if (!user || !canContinue) {
      return;
    }

    try {
      setContinuing(true);
      setError("");
      await updateDoc(doc(db, "users", user.uid), {
        onboardingStep: "review",
      });
      router.push("/onboarding/review");
    } catch (continueError) {
      const message =
        continueError instanceof Error
          ? continueError.message
          : "Could not continue to review.";
      setError(message);
    } finally {
      setContinuing(false);
    }
  };

  if (authLoading || loadingContext) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const totalDocuments = documents.length;

  const uploadEntries = Object.values(uploadProgress);

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <section className="rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10 md:p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Stage 4</span>
              <span className="text-[#1B2A4A]/70">Upload & Organize</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
              <div className="h-2 w-2/3 rounded-full bg-[#C9A84C]" />
            </div>
          </div>
          <h1 className="mt-4 text-3xl font-bold md:text-4xl">Upload your financial documents</h1>
          <p className="mt-2 text-sm text-[#1B2A4A]/75 md:text-base">
            Upload statements first. You&apos;ll review and edit transactions in the next step.
          </p>
        </section>

        <section
          className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${
            dragActive
              ? "border-[#C9A84C] bg-[#C9A84C]/10"
              : "border-[#C9A84C]/60 bg-[#FFF9E8]"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void handleFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <p className="text-base font-semibold">Drag and drop CSV/PDF files here</p>
          <p className="mt-1 text-sm text-[#1B2A4A]/70">or</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-sm font-semibold text-[#1B2A4A]"
          >
            Click to browse
          </button>
          <p className="mt-2 text-xs text-[#1B2A4A]/60">Accepted: .csv, .pdf (max 10MB each)</p>

          {uploadEntries.length > 0 ? (
            <div className="mt-5 space-y-3 text-left">
              {uploadEntries.map((entry) => (
                <div key={entry.fileName} className="rounded-xl bg-white p-3">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{entry.fileName}</span>
                    <span>{entry.progress}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#F4F6FA]">
                    <div
                      className="h-2 rounded-full bg-[#C9A84C]"
                      style={{ width: `${Math.max(0, Math.min(100, entry.progress))}%` }}
                    />
                  </div>
                  {entry.error ? (
                    <p className="mt-1 text-xs font-medium text-red-600">{entry.error}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">All Documents</h2>
          {documents.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 text-sm text-[#1B2A4A]/70 shadow-md ring-1 ring-[#1B2A4A]/10">
              No documents yet — upload your first statement above.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[
                { uid: user.uid, title: `${currentUserName}'s Documents`, waiting: false },
                spouseMember
                  ? {
                      uid: spouseMember.uid,
                      title: `${getDisplayName(
                        spouseMember.firstName,
                        spouseMember.lastName,
                        spouseMember.displayName,
                      )}'s Documents`,
                      waiting: false,
                    }
                  : { uid: "spouse", title: "Waiting for spouse", waiting: true },
              ].map((panel) => {
                const assignedDocs = panel.waiting
                  ? []
                  : (docsByAssignedMember[panel.uid] ?? []);

                return (
                  <div key={panel.uid} className="space-y-3">
                    <h3 className="text-base font-semibold">{panel.title}</h3>
                    {panel.waiting ? (
                      <div className="rounded-2xl bg-white p-4 text-sm text-[#1B2A4A]/70 shadow-md ring-1 ring-[#1B2A4A]/10">
                        Waiting for spouse to join.
                      </div>
                    ) : assignedDocs.length === 0 ? (
                      <div className="rounded-2xl bg-white p-4 text-sm text-[#1B2A4A]/70 shadow-md ring-1 ring-[#1B2A4A]/10">
                        No documents assigned here yet.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {assignedDocs.map((docItem) => {
                          const uploaderId =
                            typeof docItem.uploadedBy === "string" ? docItem.uploadedBy : "";
                          const isOwner = uploaderId === user.uid;
                          const fileType =
                            typeof docItem.fileType === "string" ? docItem.fileType : "other";
                          const fileIcon =
                            fileType === "csv" ? "📄" : fileType === "pdf" ? "📑" : "📁";
                          const assignedToValue =
                            typeof docItem.assignedTo === "string"
                              ? docItem.assignedTo
                              : uploaderId || user.uid;

                          return (
                            <article
                              key={docItem.id}
                              className="group rounded-2xl bg-white p-4 shadow-md ring-1 ring-[#1B2A4A]/10 md:p-5"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-base font-semibold">
                                    {fileIcon} {docItem.fileName || "Document"}
                                  </p>
                                  <p className="mt-1 text-xs text-[#1B2A4A]/65">
                                    Uploaded by {docItem.uploadedByName || "Unknown"} on{" "}
                                    {formatUploadedAt(docItem.uploadedAt)}
                                  </p>
                                </div>
                                {isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      deleteDocument(docItem.id, String(docItem.storagePath || ""))
                                    }
                                    className="hidden text-xs font-semibold text-red-600 hover:underline md:group-hover:block"
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>

                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <label className="space-y-1">
                                  <span className="text-xs font-medium text-[#1B2A4A]/70">
                                    Assigned to
                                  </span>
                                  <select
                                    value={assignedToValue}
                                    onChange={(event) => {
                                      const memberName =
                                        memberNameByUid.get(event.target.value) || "Unknown";
                                      void updateDocumentField(docItem.id, {
                                        assignedTo: event.target.value,
                                        assignedToName: memberName,
                                      });
                                    }}
                                    className="h-10 w-full rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
                                  >
                                    {members.map((member) => (
                                      <option key={member.uid} value={member.uid}>
                                        {getDisplayName(
                                          member.firstName,
                                          member.lastName,
                                          member.displayName,
                                        )}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="space-y-1">
                                  <span className="text-xs font-medium text-[#1B2A4A]/70">
                                    Note
                                  </span>
                                  <input
                                    defaultValue={
                                      typeof docItem.note === "string" ? String(docItem.note) : ""
                                    }
                                    placeholder="Add a note about this document"
                                    onBlur={(event) =>
                                      void updateDocumentField(docItem.id, {
                                        note: event.target.value.trim(),
                                      })
                                    }
                                    className="h-10 w-full rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
                                  />
                                </label>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                <span className="text-xs text-[#1B2A4A]/60">
                                  Status: {docItem.status || "uploaded"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void previewDocument(
                                      docItem.id,
                                      typeof docItem.downloadURL === "string"
                                        ? docItem.downloadURL
                                        : undefined,
                                      typeof docItem.storagePath === "string"
                                        ? docItem.storagePath
                                        : undefined,
                                    )
                                  }
                                  disabled={!docItem.storagePath}
                                  className="text-xs font-semibold text-[#1B2A4A] underline underline-offset-2 disabled:cursor-not-allowed disabled:text-[#1B2A4A]/35"
                                >
                                  Download / Preview
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <button
          type="button"
          onClick={continueToReview}
          disabled={!canContinue || continuing}
          className={`inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-base font-semibold transition ${
            canContinue
              ? "bg-[#C9A84C] text-[#1B2A4A] hover:brightness-95"
              : "bg-gray-300 text-gray-600"
          }`}
        >
          {continuing ? "Continuing..." : "Continue to Review →"}
        </button>
        <div className="flex items-center justify-between text-sm text-[#1B2A4A]/75">
          <span>{totalDocuments} documents uploaded</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void purgeOrphanedDocuments()}
              className="text-xs text-red-600 underline underline-offset-2"
            >
              Sync documents
            </button>
            <Link href="/onboarding/household" className="underline underline-offset-2">
              ← Back
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
