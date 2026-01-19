"use client";

import { useEffect, useRef } from "react";
import anime from "animejs";
import { ArrowRight, Download, FileText, Folder, CheckCircle, Search, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslation } from 'react-i18next';
import '../../i18n';

export function Hero() {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        // Animation logic removed as requested by user.
    }, []);

    return (
        <section ref={containerRef} className="relative min-h-[90vh] flex flex-col items-center justify-center pt-32 pb-20 overflow-hidden bg-bg">
            {/* Background Decor: Clean Grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/50 to-bg pointer-events-none" />

            {/* Mesh Gradient fallback if needed, or simple radial */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-brand/5 blur-3xl rounded-full opacity-50 pointer-events-none" />


            {/* Text Content */}
            <div className="relative z-10 text-center max-w-4xl px-6 mb-16 animate-in fade-in zoom-in duration-700 slide-in-from-bottom-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-medium mb-6 border border-brand/20">
                    <span className="flex h-2 w-2 rounded-full bg-brand animate-pulse" />
                    {t('hero.badge')}
                </div>
                {/* Use standard text color instead of gradient clip for better visibility on white */}
                <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-text-1" dangerouslySetInnerHTML={{ __html: t('hero.title') }} />
                <p className="text-lg md:text-xl text-text-2 mb-10 max-w-2xl mx-auto leading-relaxed">
                    {t('hero.subtitle')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link
                        href="/download"
                        className="flex items-center gap-2 px-8 py-4 rounded-full bg-brand text-white font-semibold text-lg hover:bg-brand-hover hover:scale-105 transition-all shadow-xl shadow-brand/25 active:scale-95"
                    >
                        <Download className="w-5 h-5" />
                        {t('hero.download_mac')}
                    </Link>
                    <Link
                        href="/pricing"
                        className="flex items-center gap-2 px-8 py-4 rounded-full bg-surface border border-border text-text-1 font-semibold text-lg hover:bg-surface-alt hover:border-brand/30 transition-all active:scale-95"
                    >
                        {t('hero.view_pricing')}
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>

            {/* Removed Mock Demo as requested */}

        </section>
    );
}
