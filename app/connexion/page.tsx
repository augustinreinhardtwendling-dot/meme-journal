import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion — Meme Journal" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Meme Journal</h1>
      <p className="mt-1 text-sm text-muted">Journal privé des memecoins pump.fun.</p>
      <LoginForm />
    </main>
  );
}
