'use client';

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { Button } from '@/components/ui/button';
import { Locale } from '@/i18n-config';
import Link from 'next/link';
import { ArrowRight, Download, Puzzle, CreditCard } from 'lucide-react';

interface HeroProps {
    lang: Locale;
    dict: any;
}

export function Hero({ lang, dict }: HeroProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Elements
        const filePanel = containerRef.current.querySelector('.hero-file-panel');
        const mainPanel = containerRef.current.querySelector('.hero-main-panel');
        const sidePanel = containerRef.current.querySelector('.hero-side-panel');
        const splitLine = containerRef.current.querySelector('.hero-split-line');
        const connectLine = containerRef.current.querySelector('.hero-connect-line');
        const pluginCard = containerRef.current.querySelectorAll('.hero-plugin-card');

        // Reset initial state
        anime.set([filePanel, mainPanel, sidePanel], { opacity: 0, translateY: 50 });
        anime.set(splitLine, { scaleY: 0, opacity: 0 });
        anime.set(connectLine, { opacity: 0, width: 0 });
        anime.set(pluginCard, { opacity: 0, scale: 0.8, translateX: 50 });

        const tl = anime.timeline({
            easing: 'easeOutExpo',
            duration: 800,
        });

        tl
            // 0.0-0.8s: Panels slide in
            .add({
                targets: [filePanel, mainPanel, sidePanel],
                opacity: 1,
                translateY: 0,
                delay: anime.stagger(100),
            })
            // 0.8-1.6s: Split screen emphasis
            .add({
                targets: splitLine,
                scaleY: 1,
                opacity: 1,
            })
            // 1.6-2.4s: Connection lines
            .add({
                targets: connectLine,
                width: '100%',
                opacity: 1,
                easing: 'easeInOutQuad',
            })
            // 2.4-3.2s: Plugins snap in
            .add({
                targets: pluginCard,
                opacity: 1,
                scale: 1,
                translateX: 0,
                delay: anime.stagger(100),
                begin: () => {
                    // Add snap sound effect if desired?
                }
            })
            // Breathing effect
            .add({
                targets: [mainPanel, sidePanel],
                boxShadow: [
                    '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    '0 20px 25px -5px rgba(26, 83, 54, 0.1)' // King Forest tint
                ],
                duration: 2000,
                direction: 'alternate',
                loop: true,
                easing: 'easeInOutSine'
            });

        return () => {
            tl.pause();
        };
    }, []);

    return (
        <section className="relative overflow-hidden bg-white pt-24 pb-32 lg:pt-40 lg:pb-48">

            {/* Background decoration */}
            <div className="absolute top-0 right-0 -z-10 h-full w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-king-mint-lightest/40 via-transparent to-transparent" />

            <div className="container mx-auto px-4 md:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

                    {/* Text Content */}
                    <div className="max-w-2xl">
                        <h1 className="text-4xl font-extrabold tracking-tight text-neutral-dark-bg sm:text-5xl md:text-6xl lg:text-5xl xl:text-6xl mb-6">
                            <span className="block">{dict.common.hero.title}</span>
                            <span className="block text-king-forest mt-2">{dict.common.hero.subtitle.split('，')[0]}</span>
                        </h1>
                        <p className="mt-8 text-xl text-neutral-gray-medium max-w-lg mb-12">
                            {dict.common.hero.subtitle} {dict.common.hero.description}
                        </p>

                        <div className="flex flex-col sm:flex-row gap-6">
                            <Link href={`/${lang}/download`}>
                                <Button size="lg" className="w-full sm:w-auto gap-2 text-base font-bold shadow-lg shadow-king-forest/20">
                                    <Download className="w-4 h-4" />
                                    {dict.common.hero.cta.download}
                                </Button>
                            </Link>
                            <Link href={`/${lang}/pricing`}>
                                <Button variant="outline" size="lg" className="w-full sm:w-auto gap-2 text-base">
                                    <CreditCard className="w-4 h-4" />
                                    {dict.common.hero.cta.pricing}
                                </Button>
                            </Link>
                            <Link href={`/${lang}/plugins`}>
                                <Button variant="ghost" size="lg" className="w-full sm:w-auto gap-2 text-king-forest hover:bg-king-mint-lightest font-medium">
                                    <Puzzle className="w-4 h-4" />
                                    {dict.common.hero.cta.plugins} <ArrowRight className="w-4 h-4 ml-1" />
                                </Button>
                            </Link>
                        </div>
                    </div>

                    {/* Animation Stage */}
                    <div ref={containerRef} className="relative h-[400px] w-full rounded-2xl border border-neutral-gray-light bg-neutral-gray-pale p-4 shadow-xl lg:h-[500px] overflow-hidden">

                        {/* Abstract Workdeck UI */}
                        <div className="absolute inset-0 flex p-6 gap-4">

                            {/* File Panel (Left) */}
                            <div className="hero-file-panel w-1/4 h-full bg-white rounded-xl border border-neutral-gray-light shadow-sm flex flex-col p-3 gap-2">
                                <div className="h-4 w-1/2 bg-neutral-gray-light/30 rounded" />
                                <div className="h-2 w-full bg-neutral-gray-light/20 rounded mt-4" />
                                <div className="h-2 w-3/4 bg-neutral-gray-light/20 rounded" />
                                <div className="h-2 w-full bg-neutral-gray-light/20 rounded" />
                            </div>

                            {/* Main Workspace (Middle) */}
                            <div className="hero-main-panel flex-1 h-full bg-white rounded-xl border border-neutral-gray-light shadow-sm relative overflow-hidden flex">
                                {/* Left Half of Main */}
                                <div className="w-1/2 h-full p-4 border-r border-dashed border-neutral-gray-light/50">
                                    <div className="h-6 w-1/3 bg-neutral-gray-light/40 rounded mb-4" />
                                    <div className="space-y-3">
                                        <div className="h-2 w-full bg-neutral-gray-light/20 rounded" />
                                        <div className="h-2 w-full bg-neutral-gray-light/20 rounded" />
                                        <div className="h-2 w-5/6 bg-neutral-gray-light/20 rounded" />

                                        {/* Connect Line Origin */}
                                        <div className="relative">
                                            <span className="block h-2 w-full bg-king-forest/10 rounded" />
                                            <div className="hero-connect-line absolute top-1/2 left-full h-0.5 bg-king-mint z-10" style={{ transformOrigin: 'left' }} />
                                        </div>

                                        <div className="h-2 w-full bg-neutral-gray-light/20 rounded" />
                                    </div>
                                </div>

                                {/* Split Line Indicator */}
                                <div className="hero-split-line absolute left-1/2 top-0 bottom-0 w-px bg-king-forest/20" />

                                {/* Right Half of Main (Reference/AI) */}
                                <div className="w-1/2 h-full bg-neutral-gray-pale/30 p-4">
                                    <div className="h-6 w-1/2 bg-king-mint-lightest rounded mb-4" />
                                    <div className="space-y-3">
                                        <div className="h-16 w-full bg-white border border-king-mint/20 rounded-lg shadow-sm p-2">
                                            <div className="h-2 w-1/3 bg-king-mint/20 rounded mb-1" />
                                            <div className="h-1.5 w-full bg-neutral-gray-light/20 rounded" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Side Panel (Right) - Plugins */}
                            <div className="hero-side-panel w-1/5 h-full bg-neutral-gray-pale rounded-xl border border-neutral-gray-light/50 flex flex-col items-center py-4 gap-3">
                                <div className="hero-plugin-card w-12 h-12 rounded-xl bg-white shadow-md border border-king-mint/20 flex items-center justify-center">
                                    <div className="w-6 h-6 rounded bg-king-mint/20" />
                                </div>
                                <div className="hero-plugin-card w-12 h-12 rounded-xl bg-white shadow-md border border-neutral-gray-light flex items-center justify-center">
                                    <div className="w-6 h-6 rounded bg-orange-100" />
                                </div>
                                <div className="hero-plugin-card w-12 h-12 rounded-xl bg-white shadow-md border border-neutral-gray-light flex items-center justify-center">
                                    <div className="w-6 h-6 rounded bg-blue-100" />
                                </div>
                            </div>

                        </div>

                    </div>
                </div>
            </div>
        </section>
    );
}
