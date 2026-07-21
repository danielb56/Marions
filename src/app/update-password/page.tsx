import { Logo } from "@/components/logo";
import { PasswordForm } from "@/components/password-form";
export default function UpdatePasswordPage() { return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5"><Logo href="/" /><div className="mt-8 rounded-3xl border border-[#dfdbd1] bg-white p-8"><h1 className="text-2xl font-semibold">Choose a new password</h1><p className="mb-6 mt-2 text-sm text-[#697370]">Use a unique password you do not use elsewhere.</p><PasswordForm mode="update" /></div></main>; }
