import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="bg-bg min-h-screen flex flex-col items-center justify-center p-6">
            <div className="absolute top-6 left-6">
                <Link href="/" className="flex items-center gap-2 text-text-2 hover:text-text-1 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back to Home
                </Link>
            </div>

            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex w-12 h-12 rounded-xl bg-brand items-center justify-center text-white text-2xl font-bold mb-4 shadow-lg">
                        K
                    </div>
                    <h1 className="text-2xl font-bold text-text-1">Welcome back</h1>
                </div>
                {children}
            </div>
        </div>
    );
}
