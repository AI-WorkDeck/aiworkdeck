'use client';

import { useEffect, useState } from 'react';
import { Locale } from '@/i18n-config';

// Client Component
export function ShowcaseContent({ lang, dict }: { lang: Locale; dict: any }) {
    const [activeVideo, setActiveVideo] = useState<string | null>(null);

    // Initial Scroll Check
    useEffect(() => {
        const hash = window.location.hash.substring(1);
        if (hash) {
            const element = document.getElementById(hash);
            if (element) {
                setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight effect logic could go here
                }, 500);
            }
        }
    }, []);

    const plugins = [
        { key: 'tts', id: 'tts' },
        { key: 'ppt', id: 'ppt' },
        // Meeting Verification (shareholder check) EXCLUDED
        { key: 'dueDiligence', id: 'dueDiligence' },
        { key: 'clipboard', id: 'clipboard' },
        { key: 'staging', id: 'staging' },
        { key: 'workLog', id: 'workLog' },
        { key: 'docLink', id: 'docLink' }
    ];

    return (
        <div className="min-h-screen pt-24 pb-20 bg-gradient-to-b from-white via-neutral-50 to-neutral-100">
            <div className="container mx-auto px-4">

                {/* Header */}
                <header className="text-center mb-12 max-w-4xl mx-auto">
                    <h1 className="text-4xl md:text-5xl font-bold text-neutral-dark-bg mb-6 tracking-tight">
                        {dict.showcasePage.title}
                    </h1>
                    <p className="text-xl text-neutral-gray-medium max-w-2xl mx-auto leading-relaxed">
                        {dict.showcasePage.subtitle}
                    </p>
                </header>

                {/* Main Intro Video */}
                <section className="mb-20">
                    <div className="max-w-5xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden border border-neutral-200/60 ring-1 ring-black/5">
                        <div className="aspect-video bg-black relative flex items-center justify-center group">
                            <video
                                controls
                                className="w-full h-full object-cover"
                                poster="/images/showcase/intro-poster.png"
                                preload="metadata"
                            >
                                <source src="/videos/intro.mp4" type="video/mp4" />
                                Your browser does not support the video tag.
                            </video>
                        </div>
                        <div className="p-8 text-center bg-white relative z-10">
                            <h2 className="text-2xl font-bold text-neutral-dark-bg mb-3">{dict.showcasePage.introVideo.title}</h2>
                            <p className="text-neutral-gray-medium max-w-3xl mx-auto">{dict.showcasePage.introVideo.description}</p>
                        </div>
                    </div>
                </section>

                {/* Plugin Videos Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10">
                    {plugins.map((plugin) => (
                        <div
                            key={plugin.key}
                            id={plugin.id}
                            className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 ease-out border border-neutral-100 hover:-translate-y-1 overflow-hidden scroll-mt-32"
                        >
                            <div className="aspect-video bg-neutral-900 relative overflow-hidden">
                                <video
                                    controls
                                    className="w-full h-full object-cover"
                                    poster={`/images/showcase/${plugin.key}-poster.png`}
                                    preload="none"
                                >
                                    <source src={`/videos/${plugin.key}.mp4`} type="video/mp4" />
                                </video>
                            </div>
                            <div className="p-6">
                                <h3 className="text-lg font-bold text-neutral-dark-bg mb-2 group-hover:text-king-forest transition-colors">
                                    {dict.showcasePage.plugins[plugin.key].title}
                                </h3>
                                <p className="text-sm text-neutral-gray-medium leading-relaxed">
                                    {dict.showcasePage.plugins[plugin.key].desc}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
