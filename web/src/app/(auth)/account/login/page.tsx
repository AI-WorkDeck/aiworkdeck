"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Loader2 } from "lucide-react";
import { useTranslation } from 'react-i18next';
import '../../../../i18n';

export default function LoginPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const { t } = useTranslation();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        // Mock login
        setTimeout(() => {
            setIsLoading(false);
            router.push("/account");
        }, 1500);
    };

    return (
        <div className="bg-surface border border-border rounded-2xl shadow-xl p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-text-1">{t('login.emailLabel')}</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 w-5 h-5" />
                        <input
                            id="email"
                            type="email"
                            required
                            placeholder={t('login.emailPlaceholder')}
                            className="w-full pl-10 pr-4 py-3 bg-bg border border-border rounded-xl focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between">
                        <label htmlFor="password" className="text-sm font-medium text-text-1">{t('login.passwordLabel')}</label>
                        <a href="#" className="text-sm text-brand hover:underline">{t('login.forgotPassword')}</a>
                    </div>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 w-5 h-5" />
                        <input
                            id="password"
                            type="password"
                            required
                            placeholder="••••••••"
                            className="w-full pl-10 pr-4 py-3 bg-bg border border-border rounded-xl focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 bg-brand text-white rounded-xl font-bold hover:bg-brand-hover shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center disabled:opacity-50 disabled:pointer-events-none"
                >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
                </button>
            </form>

            <div className="mt-6 text-center text-sm text-text-2">
                Don't have an account? <a href="#" className="text-brand font-medium hover:underline">Sign up</a>
            </div>
        </div>
    );
}
