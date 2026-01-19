"use client";

import clsx from "clsx";
import { useTranslation } from 'react-i18next';
import '../../i18n';

export function FeatureWall() {
    const { t } = useTranslation();
    const features = t('feature_wall.features', { returnObjects: true }) as string[];

    return (
        <section className="py-24 bg-bg">
            <div className="container mx-auto px-6">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-bold mb-4">{t('feature_wall.title')}</h2>
                    <p className="text-text-2 max-w-2xl mx-auto">
                        {t('feature_wall.subtitle')}
                    </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {features.map((feature, i) => (
                        <div
                            key={i}
                            className="p-6 rounded-xl bg-surface border border-border text-center font-medium text-text-1 hover:border-brand hover:text-brand transition-colors cursor-default"
                        >
                            {feature}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
