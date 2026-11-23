"use client";

import { PostForm } from "@/components/shell/PostForm";

export function AddFamilyForm() {
  return (
    <PostForm
      url="/api/host/family"
      testid="add-family"
      submit="Add family"
      fields={[
        { name: "name", label: "Family name", required: true },
        { name: "phone", label: "Mobile (optional)", type: "tel" },
        { name: "language", label: "Language", options: [{ value: "en", label: "English" }, { value: "hi", label: "हिन्दी" }] },
      ]}
      render={(r) => (
        <div className="rounded bg-green-50 p-2 text-sm">
          Added. Check-in code <b className="font-mono">{String(r.code)}</b> (shown once). Link: <code className="break-all">/f/{String(r.linkKey)}</code>
        </div>
      )}
    />
  );
}
