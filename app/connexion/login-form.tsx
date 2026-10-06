"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-8 space-y-3">
      <label className="block text-sm font-medium" htmlFor="password">
        Mot de passe
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent"
      />
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-3 py-2.5 font-medium text-accent-ink disabled:opacity-60"
      >
        {pending ? "Connexion…" : "Entrer"}
      </button>
    </form>
  );
}
