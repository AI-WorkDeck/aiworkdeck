'use client';

import { Locale } from '@/i18n-config';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Download, Mail } from 'lucide-react';
import Link from 'next/link';
import { ContactFormDialog } from '@/components/ContactFormDialog';

interface PricingProps {
    lang: Locale;
    dict: any;
}

export function Pricing({ lang, dict }: PricingProps) {
    return (
        <section className="py-16 bg-white" id="pricing">
            <div className="container mx-auto px-4 md:px-8">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-bold text-neutral-dark-bg mb-4">{dict.common.pricing.title}</h2>
                    <p className="text-neutral-gray-medium max-w-2xl mx-auto">{dict.common.pricing.subtitle}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                    {/* Open Source (Free) Plan */}
                    <Card className="border-2 hover:border-king-forest/30 transition-colors">
                        <CardHeader>
                            <CardTitle className="text-2xl">{dict.common.pricing.free.title}</CardTitle>
                            <div className="mt-2 text-3xl font-bold">{dict.common.pricing.free.price}</div>
                            <p className="text-sm text-neutral-gray-medium">{dict.common.pricing.free.desc}</p>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-3 text-sm">
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.free.perk1}</li>
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.free.perk2}</li>
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.free.perk3}</li>
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.free.perk4}</li>
                            </ul>
                        </CardContent>
                        <CardFooter>
                            <Link href="https://github.com/checkba/ai-workdeck" target="_blank" className="w-full">
                                <Button className="w-full gap-2 bg-neutral-dark-bg text-white hover:bg-neutral-dark-bg/90 shadow-md">
                                    <Download className="w-4 h-4" /> {dict.common.pricing.free.cta}
                                </Button>
                            </Link>
                        </CardFooter>
                    </Card>

                    {/* Commercial (Paid) Plan */}
                    <Card className="border-2 border-king-forest shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-king-forest text-white text-xs px-2 py-1 rounded-bl">Enterprise</div>
                        <CardHeader>
                            <CardTitle className="text-2xl text-king-forest">{dict.common.pricing.pro.title}</CardTitle>
                            <div className="mt-2 text-3xl font-bold">{dict.common.pricing.pro.price}</div>
                            <p className="text-sm text-neutral-gray-medium">{dict.common.pricing.pro.desc}</p>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-3 text-sm">
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.pro.perk1}</li>
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.pro.perk2}</li>
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.pro.perk3}</li>
                                <li className="flex gap-2"><Check className="w-4 h-4 text-king-forest" /> {dict.common.pricing.pro.perk4}</li>
                            </ul>
                        </CardContent>
                        <CardFooter>
                            <div className="w-full">
                                <ContactFormDialog
                                    triggerChild={
                                        <Button className="w-full gap-2 bg-king-forest hover:bg-king-forest/90">
                                            <Mail className="w-4 h-4" /> {dict.common.pricing.pro.cta}
                                        </Button>
                                    }
                                />
                                <p className="text-xs text-center text-neutral-gray-medium mt-2">Get a quote for your team</p>
                            </div>
                        </CardFooter>
                    </Card>
                </div>
            </div>
        </section>
    );
}
