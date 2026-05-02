import { Suspense } from "react";
import { connection } from "next/server";
import { SignUp } from "@clerk/nextjs";

async function SignUpWrapper() {
  await connection();
  return <SignUp forceRedirectUrl="/sign-up/complete" />;
}

export default function SignUpPage() {
  return (
    <div className="flex justify-center pt-16">
      <Suspense>
        <SignUpWrapper />
      </Suspense>
    </div>
  );
}
