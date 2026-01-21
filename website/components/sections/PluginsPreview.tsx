'use client';

import { useRef, useEffect } from 'react';
import anime from 'animejs';
import { Locale } from '@/i18n-config';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PluginsPreviewProps {
    lang: Locale;
    dict: any;
}

export function PluginsPreview({ lang, dict }: PluginsPreviewProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<anime.AnimeInstance | null>(null);

    useEffect(() => {
        if (!scrollRef.current) return;

        // Calculate the width of one set of items (including gap)
        // 8 items * (320px width + 24px gap) = 2752px
        // But safer to let animejs handle relative values or simple loop

        animationRef.current = anime({
            targets: scrollRef.current,
            translateX: [0, '-50%'], // Move exactly half the total width (since we duplicated the list)
            duration: 40000, // Slow, smooth scroll
            easing: 'linear',
            loop: true,
        });

        return () => animationRef.current?.pause();
    }, []);

    const handleMouseEnter = () => {
        animationRef.current?.pause();
    };

    const handleMouseLeave = () => {
        animationRef.current?.play();
    };

    return (
        <section className="py-16 bg-neutral-gray-pale overflow-hidden" id="plugins">
            <div className="container mx-auto px-4 md:px-8 text-center mb-16">
                <h2 className="text-3xl font-bold text-neutral-dark-bg mb-4">
                    {dict.common.features.ecosystem.title}
                </h2>
                <p className="text-xl text-neutral-gray-medium max-w-2xl mx-auto">
                    {dict.common.features.ecosystem.subtitle}
                </p>
                <p className="text-neutral-gray-medium mt-4 max-w-2xl mx-auto">
                    {dict.common.features.ecosystem.desc1}
                </p>
            </div>

            {/* Infinite Scroll Container */}
            <div
                className="relative w-full overflow-hidden"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <div
                    ref={scrollRef}
                    className="flex gap-6 w-max px-4"
                    style={{ willChange: 'transform' }}
                >
                    {/* Double the list to create seamless loop */}
                    {[...dict.common.features.ecosystem.items, ...dict.common.features.ecosystem.items].map((item: any, index: number) => {
                        // Calculate original index to map to 8 distinct images
                        const originalIndex = index % dict.common.features.ecosystem.items.length;
                        return (
                            <Link href={`/${lang}/showcase#${item.showcaseId || 'showcase'}`} key={index} className="block">
                                <div
                                    className="w-[320px] h-[400px] flex-shrink-0 bg-white/60 backdrop-blur-md border border-white/50 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:scale-105 transition-all duration-300 group cursor-pointer flex flex-col"
                                >
                                    {/* Image Placeholder Area */}
                                    <div className="w-full aspect-video bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg mb-6 overflow-hidden relative">
                                        {/* User will place images here */}
                                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm font-mono">
                                            /images/plugins/plugin-{originalIndex + 1}.png
                                        </div>
                                        <img
                                            src={`/images/plugins/plugin-${originalIndex + 1}.png`}
                                            alt={item.title}
                                            className="w-full h-full object-cover transition-opacity duration-300 absolute inset-0"
                                            onError={(e) => {
                                                // Fallback to keep placeholder visible if image missing
                                                (e.target as HTMLImageElement).style.opacity = '0';
                                            }}
                                        />
                                    </div>

                                    <div className="text-left">
                                        <h3 className="text-lg font-bold text-neutral-dark-bg mb-1 group-hover:text-king-forest transition-colors">
                                            {item.title}
                                        </h3>
                                        <p className="text-sm font-medium text-king-forest-lighter mb-3">
                                            {item.subtitle}
                                        </p>
                                        <p className="text-sm text-neutral-gray-medium leading-relaxed">
                                            {item.description}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>


        </section>
    );
}
