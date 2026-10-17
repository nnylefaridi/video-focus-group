import { Suspense } from "react";
import { LoginForm } from "@/components/account/LoginForm";

export default function LoginPage() {
  return (
    <main className="px-4 py-12 sm:py-16">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
