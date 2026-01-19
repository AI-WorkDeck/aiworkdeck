"use client";

import { useRef, useEffect, useState } from "react";
import clsx from "clsx";
import { useTranslation } from 'react-i18next';
import '../../i18n';

export function WorkflowDemo() {
    const { t } = useTranslation();
    const [activeStep, setActiveStep] = useState(0);
    const stepsRef = useRef<(HTMLDivElement | null)[]>([]);

    const steps = [
        {
            id: "import",
            title: t('workflow.step1.title'),
            desc: t('workflow.step1.desc'),
            // Using placeholder colors/text for now as "visuals" based on user feedback to change later
            visualContent: (
                <div className="w-full h-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <span className="text-9xl font-bold opacity-40">1</span>
                </div>
            )
        },
        {
            id: "structure",
            title: t('workflow.step2.title'),
            desc: t('workflow.step2.desc'),
            visualContent: (
                <div className="w-full h-full bg-purple-100 flex items-center justify-center text-purple-600">
                    <span className="text-9xl font-bold opacity-40">2</span>
                </div>
            )
        },
        {
            id: "verify",
            title: t('workflow.step3.title'),
            desc: t('workflow.step3.desc'),
            visualContent: (
                <div className="w-full h-full bg-green-100 flex items-center justify-center text-green-600">
                    <span className="text-9xl font-bold opacity-40">3</span>
                </div>
            )
        },
        {
            id: "draft",
            title: t('workflow.step4.title'),
            desc: t('workflow.step4.desc'),
            visualContent: (
                <div className="w-full h-full bg-orange-100 flex items-center justify-center text-orange-600">
                    <span className="text-9xl font-bold opacity-40">4</span>
                </div>
            )
        },
    ];

    useEffect(() => {
        const handleScroll = () => {
            // Use a target line at 40% of the viewport height for better "reading" sync
            const scrollPosition = window.scrollY + window.innerHeight * 0.4;

            stepsRef.current.forEach((step, index) => {
                if (!step) return;
                const { offsetTop, offsetHeight } = step;
                // Check if the step is currently crossing the target line
                if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
                    setActiveStep(index);
                }
            });
        };

        window.addEventListener('scroll', handleScroll);
        // Initial check
        handleScroll();
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <section className="bg-bg py-24 relative">
            <div className="container mx-auto px-6">
                <div className="flex flex-col lg:flex-row gap-12 lg:gap-24">
                    {/* Left: Sticky Text */}
                    <div className="lg:w-1/2 space-y-24 order-2 lg:order-1 pt-24 pb-24">
                        {steps.map((step, index) => (
                            <div
                                key={step.id}
                                ref={(el: any) => (stepsRef.current[index] = el)}
                                className={clsx(
                                    "flex flex-col justify-center min-h-[60vh] transition-opacity duration-500",
                                    activeStep === index ? "opacity-100" : "opacity-30"
                                )}
                            >
                                <h3 className="text-3xl font-bold mb-4 text-text-1">{step.title}</h3>
                                <p className="text-xl text-text-2 leading-relaxed">
                                    {step.desc}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Right: Sticky Visual */}
                    <div className="lg:w-1/2 h-screen sticky top-0 flex items-center justify-center order-1 lg:order-2">
                        <div className="relative w-full aspect-square max-w-lg bg-surface border border-border rounded-3xl shadow-2xl overflow-hidden flex items-center justify-center">
                            {/* Dynamic Content based on Active Step */}
                            {steps.map((step, index) => (
                                <div
                                    key={step.id}
                                    className={clsx(
                                        "absolute inset-0 flex items-center justify-center transition-all duration-700 ease-in-out p-6",
                                        activeStep === index ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-8 pointer-events-none"
                                    )}
                                >
                                    {/* Enhanced Visual Visibility */}
                                    <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-inner">
                                        {step.visualContent}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
