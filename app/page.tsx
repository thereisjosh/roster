import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/get-session";

export default async function Home() {
  const session = await getServerSession();

  if (session?.user) {
    redirect("/dashboard");
  }

  redirect("/login");
}
