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
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!cardRef.current) return;

        const card = cardRef.current;

        // Initial entrance animation
        anime({
            targets: card,
            opacity: [0, 1],
            translateY: [100, 0],
            rotateX: [20, 0],
            duration: 1200,
            easing: 'easeOutExpo',
            delay: 200
        });

        // 3D Tilt Effect on Mouse Move
        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current || !cardRef.current) return;

            const container = containerRef.current;
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Calculate rotation values (limit to +/- 5 degrees)
            const rotateX = ((y - centerY) / centerY) * -5;
            const rotateY = ((x - centerX) / centerX) * 5;

            anime({
                targets: card,
                rotateX: rotateX,
                rotateY: rotateY,
                duration: 400,
                easing: 'easeOutQuad'
            });
        };

        const handleMouseLeave = () => {
            anime({
                targets: card,
                rotateX: 0,
                rotateY: 0,
                duration: 600,
                easing: 'easeOutElastic(1, .8)'
            });
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener('mousemove', handleMouseMove);
            container.addEventListener('mouseleave', handleMouseLeave);
        }

        return () => {
            if (container) {
                container.removeEventListener('mousemove', handleMouseMove);
                container.removeEventListener('mouseleave', handleMouseLeave);
            }
        };
    }, []);

    return (
        <section className="relative overflow-hidden bg-white pt-24 pb-12 lg:pt-40 lg:pb-24">

            {/* Background decoration - Enhanced */}
            <div className="absolute top-0 right-0 -z-10 h-full w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-king-mint-lightest/40 via-transparent to-transparent" />
            <div className="absolute top-1/4 right-0 -z-10 w-[600px] h-[600px] bg-king-mint/5 rounded-full blur-3xl opacity-50 pointer-events-none" />

            <div className="container mx-auto px-4 md:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">

                    {/* Text Content - Spans 5 cols */}
                    <div className="max-w-2xl z-10 lg:col-span-5">
                        <h1 className="text-4xl font-extrabold tracking-tight text-neutral-dark-bg sm:text-5xl md:text-6xl lg:text-5xl xl:text-6xl mb-6">
                            <span className="block">{dict.common.hero.title}</span>
                            <span className="block text-king-forest mt-2">{dict.common.hero.subtitle.split('，')[0]}</span>
                        </h1>
                        <p className="mt-8 text-xl text-neutral-gray-medium max-w-lg mb-12 leading-relaxed">
                            {dict.common.hero.description}
                        </p>

                        <div className="flex flex-col sm:flex-row gap-6">
                            <Link href={`/${lang}#pricing`}>
                                <Button size="lg" className="w-full sm:w-auto gap-2 text-base font-bold shadow-lg shadow-king-forest/20 hover:shadow-xl hover:-translate-y-0.5 transition-all bg-king-forest text-white hover:bg-king-forest/90">
                                    <CreditCard className="w-4 h-4" />
                                    {dict.common.hero.cta.pricing}
                                </Button>
                            </Link>
                            <Link href={`/${lang}#plugins`}>
                                <Button variant="outline" size="lg" className="w-full sm:w-auto gap-2 text-base bg-white border-2 border-neutral-gray-light text-neutral-dark-bg hover:bg-neutral-gray-pale hover:border-neutral-gray-medium transition-all font-bold">
                                    <Puzzle className="w-4 h-4" />
                                    {dict.common.hero.cta.plugins}
                                </Button>
                            </Link>
                        </div>
                    </div>

                    {/* Animation Stage - 3D Tilt Container - Spans 7 cols and overflows */}
                    <div className="lg:col-span-7 relative w-full perspective-1000 flex items-center justify-center lg:justify-end">
                        <div ref={containerRef} className="relative w-full h-[350px] sm:h-[450px] lg:h-[600px] flex items-center justify-center z-10">
                            {/* Tilting Card - Massive Size */}
                            <div ref={cardRef} className="relative w-full aspect-[16/10] rounded-2xl shadow-2xl shadow-king-forest/10 bg-white border border-white/50 backdrop-blur-sm overflow-hidden transform-gpu" style={{ transformStyle: 'preserve-3d' }}>

                                {/* Main Image */}
                                <img
                                    src="/images/hero-dashboard.png"
                                    alt="AI Workdeck Dashboard"
                                    className="w-full h-full object-cover object-top scale-105 hover:scale-100 transition-transform duration-700"
                                    onError={(e) => {
                                        // Fallback if image doesn't exist
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIiB2aWV3Qm94PSIwIDAgODAwIDYwMCI+PHJlY3Qgd2lkdGg9IjgwMCIgaGVpZ2h0PSI2MDAiIGZpbGw9IiNmMmZjZjkiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9ImFyaWFsIiBmb250LXNpemU9IjI0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOWJiZWE1Ij5IZXJvIERhc2hib2FyZCBJbWFnZTwvdGV4dD48L3N2Zz4=';
                                    }}
                                />

                                {/* Floating Overlay Badge 1 - Top Right - More Premium */}
                                <div className="absolute top-6 right-6 lg:top-10 lg:right-10 bg-white/80 backdrop-blur-md border border-white/60 shadow-xl rounded-2xl p-4 flex items-center gap-4 transform translate-z-20 animate-float-slow ring-1 ring-black/5">
                                    <div className="relative">
                                        <div className="w-3 h-3 rounded-full bg-king-mint animate-pulse relative z-10" />
                                        <div className="absolute inset-0 w-3 h-3 rounded-full bg-king-mint animate-ping opacity-75" />
                                    </div>
                                    <span className="text-sm font-bold text-neutral-dark-bg tracking-wide">AI Analyzing...</span>
                                </div>

                                {/* Floating Overlay Badge 2 - Bottom Left - More Detailed */}
                                <div className="absolute bottom-6 left-6 lg:bottom-12 lg:left-12 bg-white/80 backdrop-blur-md border border-white/60 shadow-xl rounded-2xl p-4 flex items-center gap-4 transform translate-z-20 animate-float-delayed ring-1 ring-black/5">
                                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-king-mint-lightest to-white text-king-forest shadow-sm">
                                        <Puzzle className="w-5 h-5" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase tracking-wider text-neutral-gray-medium font-semibold">Plugin Loaded</span>
                                        <span className="text-sm font-bold text-neutral-dark-bg">Data Extractor Pro</span>
                                    </div>
                                </div>

                                {/* Glare Effect - Subtler */}
                                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/20 pointer-events-none mix-blend-overlay" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Scroll Indicator */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-bounce hidden md:block">
                <div className="p-2 rounded-full bg-white/50 backdrop-blur border border-neutral-gray-light text-neutral-gray-medium shadow-sm">
                    <ArrowRight className="w-5 h-5 rotate-90" />
                </div>
            </div>
        </section>
    );
}
