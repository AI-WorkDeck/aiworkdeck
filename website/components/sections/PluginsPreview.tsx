'use client';

import { Locale } from '@/i18n-config';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PluginsPreviewProps {
    lang: Locale;
    dict: any;
}

export function PluginsPreview({ lang, dict }: PluginsPreviewProps) {
    return (
        <section className="py-24 bg-neutral-gray-pale">
            <div className="container mx-auto px-4 md:px-8 text-center">
                <h2 className="text-3xl font-bold text-neutral-dark-bg mb-4">
                    {dict.common.features.ecosystem.title}
                </h2>
                <p className="text-xl text-neutral-gray-medium mb-12 max-w-2xl mx-auto">
                    {dict.common.features.ecosystem.subtitle}
                </p>

                {/* Plugin Grid Mockup */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-12">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-neutral-gray-light hover:shadow-md transition-shadow flex flex-col items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gray-100" />
                            <div className="h-3 w-20 bg-gray-100 rounded" />
                        </div>
                    ))}
                </div>

                <Link href={`/${lang}/plugins`}>
                    <Button size="lg" className="shadow-lg">
                        {dict.common.hero.cta.plugins}
                    </Button>
                </Link>
            </div>
        </section>
    );
}
