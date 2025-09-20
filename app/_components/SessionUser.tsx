import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";

export default function SessionUser({
  children,
}: {
  children: (user: { email: string } | null) => React.ReactNode;
}) {
  let user: { email: string } | null = null;
  try {
    let cookieStore: any = cookies();
    if (typeof cookieStore.then === "function") {
      // If cookies() returns a Promise, this is not supported in a sync component
      // so we fallback to null user (or could throw an error)
      cookieStore = null;
    }
    const tokenCookie = cookieStore ? cookieStore.get("token") : null;
    const token = tokenCookie ? tokenCookie.value : undefined;
    if (token) {
      const payload = verifyToken(token);
      if (payload && payload.email) {
        user = { email: payload.email };
      }
    }
  } catch {}
  return <>{children(user)}</>;
}
