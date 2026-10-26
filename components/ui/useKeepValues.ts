"use client";

import { useTransition } from "react";

/**
 * React 19 clears a <form action={…}> after every submit, including one that
 * comes back with an error, so the person would lose what they typed. This
 * handler submits the form itself (keeping their values) once the page is
 * interactive. Keep `action` on the form too: before JavaScript has loaded,
 * the browser posts to the server action directly.
 *
 *   const [state, formAction, pending] = useActionState(action, {});
 *   <form action={formAction} onSubmit={useKeepValues(formAction)}>
 */
export function useKeepValues(dispatch: (fd: FormData) => void) {
  const [, startTransition] = useTransition();
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
}
