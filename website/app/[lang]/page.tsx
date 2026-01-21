import { getDictionary } from '@/get-dictionary';
import { Locale } from '@/i18n-config';
import { Hero } from '@/components/sections/Hero';
import { Highlights } from '@/components/sections/Highlights';
import { PluginsPreview } from '@/components/sections/PluginsPreview';
import { Pricing } from '@/components/sections/Pricing';
import Link from 'next/link';

export default async function Home({
  params,
}: {
  params: Promise<{ lang: Locale }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang);

  return (
    <>
      <Hero lang={lang} dict={dict} />
      <Highlights lang={lang} dict={dict} />
      <PluginsPreview lang={lang} dict={dict} />
      <Pricing lang={lang} dict={dict} />

      {/* Final CTA */}
      <section className="py-16 bg-king-forest text-white flex items-center justify-center">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            {dict.common.ctaSection.title}
          </h2>
        </div>
      </section>
    </>
  );
}
