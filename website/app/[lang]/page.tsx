import { getDictionary } from '@/get-dictionary';
import { Locale } from '@/i18n-config';
import { Hero } from '@/components/sections/Hero';
import { Highlights } from '@/components/sections/Highlights';
import { PluginsPreview } from '@/components/sections/PluginsPreview';
import { Pricing } from '@/components/sections/Pricing';

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
      <section className="py-20 bg-king-forest text-white text-center">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-6">从今天开始，把你的文档工作搬到 Workdeck 上。</h2>
          <div className="flex justify-center gap-4">
            <button className="bg-white text-king-forest px-8 py-3 rounded-lg font-bold hover:bg-neutral-gray-pale transition-colors">
              {dict.common.hero.cta.download}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
