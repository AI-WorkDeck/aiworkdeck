'use client';

import { Locale } from '@/i18n-config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, Layout, Puzzle } from 'lucide-react';

interface HighlightsProps {
    lang: Locale;
    dict: any; // Type strictly if possible
}

export function Highlights({ lang, dict }: HighlightsProps) {
    const features = [
        {
            key: 'ai',
            icon: Zap,
            title: dict.common.features.ai.title,
            desc: [
                dict.common.features.ai.desc1,
                dict.common.features.ai.desc2,
                dict.common.features.ai.desc3
            ],
            color: 'text-king-mint'
        },
        {
            key: 'oneStop',
            icon: Layout,
            title: dict.common.features.oneStop.title,
            subtitle: dict.common.features.oneStop.subtitle,
            desc: [], // Simplified for now based on PRD
            color: 'text-blue-400'
        },
        {
            key: 'ecosystem',
            icon: Puzzle,
            title: dict.common.features.ecosystem.title,
            subtitle: dict.common.features.ecosystem.subtitle,
            desc: [dict.common.features.ecosystem.subtitle],
            color: 'text-orange-400'
        }
    ];

    return (
        <section className="py-24 bg-white">
            <div className="container mx-auto px-4 md:px-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {features.map((feature, index) => (
                        <Card key={feature.key} variant="outline" className="group hover:border-king-forest/30 hover:shadow-lg transition-all duration-300">
                            <CardHeader>
                                <div className={`w-12 h-12 rounded-lg bg-neutral-gray-pale flex items-center justify-center mb-4 group-hover:bg-king-forest/10 transition-colors`}>
                                    <feature.icon className={`w-6 h-6 ${feature.color}`} />
                                </div>
                                <CardTitle className="text-xl font-bold text-neutral-dark-bg">
                                    {feature.title}
                                </CardTitle>
                                {feature.subtitle && (
                                    <p className="text-sm font-medium text-king-forest mt-1">{feature.subtitle}</p>
                                )}
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {feature.desc.map((line: string, i: number) => (
                                        <li key={i} className="text-neutral-gray-medium text-sm leading-relaxed">
                                            {line}
                                        </li>
                                    ))}
                                    {feature.desc.length === 0 && (
                                        <li className="text-neutral-gray-medium text-sm leading-relaxed">
                                            More details regarding this feature...
                                        </li>
                                    )}
                                </ul>

                                {/* Visual Hint Mockup Area */}
                                <div className="mt-6 h-32 bg-neutral-gray-pale rounded-lg border border-neutral-gray-light/50 overflow-hidden relative group-hover:border-king-forest/20 transition-colors">
                                    {/* Abstract content based on feature */}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-30">
                                        {index === 0 && <span className="text-4xl font-mono">AI</span>}
                                        {index === 1 && <div className="grid grid-cols-2 gap-1 w-1/2 h-1/2"><div className="bg-gray-400/50 rounded" /><div className="bg-gray-400/50 rounded" /></div>}
                                        {index === 2 && <Puzzle className="w-12 h-12" />}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </section>
    );
}
