"use client";

import { Zap, ShieldCheck, Database } from "lucide-react";
import { useTranslation } from 'react-i18next';
import '../../i18n';

export function ValueProp() {
    const { t } = useTranslation();
    const values = [
        {
            icon: <Zap className="w-6 h-6 text-brand-accent" />,
            title: t('value_prop.efficiency.title'),
            description: t('value_prop.efficiency.desc'),
        },
        {
            icon: <ShieldCheck className="w-6 h-6 text-brand-accent" />,
            title: t('value_prop.risk.title'),
            description: t('value_prop.risk.desc'),
        },
        {
            icon: <Database className="w-6 h-6 text-brand-accent" />,
            title: t('value_prop.assets.title'),
            description: t('value_prop.assets.desc'),
        },
    ];

    return (
        <section className="py-24 bg-surface-alt/30 border-y border-divider">
            <div className="container mx-auto px-6">
                <div className="grid md:grid-cols-3 gap-12">
                    {values.map((v, i) => (
                        <div key={i} className="group p-6 rounded-2xl bg-surface border border-border hover:border-brand/30 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                            <div className="w-12 h-12 rounded-xl bg-brand/10 flex items-center justify-center mb-6 group-hover:bg-brand group-hover:text-white transition-colors">
                                {v.icon}
                            </div>
                            <h3 className="text-xl font-bold mb-3 text-text-1">{v.title}</h3>
                            <p className="text-text-2 leading-relaxed">{v.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
