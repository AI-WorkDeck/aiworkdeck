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
            subtitle: dict.common.features.ai.subtitle,
            desc: [
                dict.common.features.ai.desc1,
                dict.common.features.ai.desc2
            ],
            color: 'text-king-mint'
        },
        {
            key: 'oneStop',
            icon: Layout,
            title: dict.common.features.oneStop.title,
            subtitle: dict.common.features.oneStop.subtitle,
            desc: [
                dict.common.features.oneStop.desc1,
                dict.common.features.oneStop.desc2
            ],
            color: 'text-blue-400'
        },
        {
            key: 'ecosystem',
            icon: Puzzle,
            title: dict.common.features.ecosystem.title,
            subtitle: dict.common.features.ecosystem.subtitle,
            desc: [
                dict.common.features.ecosystem.desc1,
                dict.common.features.ecosystem.desc2
            ],
            color: 'text-orange-400'
        }
    ];

    return (
        <section className="py-24 bg-white" id="product">
            <div className="container mx-auto px-4 md:px-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {features.map((feature, index) => (
                        <Card key={feature.key} variant="outline" className="group hover:border-king-forest/30 hover:shadow-lg transition-all duration-300">
                            <CardHeader className="relative pb-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-xl font-bold text-neutral-dark-bg">
                                            {feature.title}
                                        </CardTitle>
                                        {feature.subtitle && (
                                            <p className="text-sm font-medium text-king-forest mt-1">{feature.subtitle}</p>
                                        )}
                                    </div>
                                    <div className={`w-10 h-10 rounded-lg bg-neutral-gray-pale flex items-center justify-center group-hover:bg-king-forest/10 transition-colors`}>
                                        <feature.icon className={`w-5 h-5 ${feature.color}`} />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {feature.desc.map((line: string, i: number) => (
                                        <p key={i} className={`text-sm leading-relaxed ${i === 1 ? 'text-king-forest/90 font-medium' : 'text-neutral-gray-medium'}`}>
                                            {line}
                                        </p>
                                    ))}
                                </div>

                                {/* Visual Hint Mockup Area */}
                                <div className="mt-6 h-32 bg-neutral-gray-pale rounded-lg border border-neutral-gray-light/50 overflow-hidden relative group-hover:border-king-forest/20 transition-colors">
                                    <div className="absolute inset-0">
                                        {/* Background Image */}
                                        <img
                                            src={
                                                feature.key === 'ai' ? '/images/card-ai-agent.png' :
                                                    feature.key === 'oneStop' ? '/images/card-workdeck.png' :
                                                        '/images/card-plugins.png'
                                            }
                                            alt={feature.title}
                                            className="w-full h-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
                                            onError={(e) => {
                                                // Fallback to placeholder if image fails to load
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                            }}
                                        />

                                        {/* Fallback Abstract/Loading State (Hidden by default if image loads) */}
                                        <div className="hidden absolute inset-0 flex items-center justify-center opacity-30 bg-neutral-gray-pale">
                                            {index === 0 && <span className="text-4xl font-mono">AI</span>}
                                            {index === 1 && <div className="grid grid-cols-2 gap-1 w-1/2 h-1/2"><div className="bg-gray-400/50 rounded" /><div className="bg-gray-400/50 rounded" /></div>}
                                            {index === 2 && <Puzzle className="w-12 h-12" />}
                                        </div>
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
