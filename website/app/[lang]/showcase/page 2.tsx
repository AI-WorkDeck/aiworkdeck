import { getDictionary } from '@/get-dictionary';
import { Locale } from '@/i18n-config';
import { ShowcaseContent } from './ShowcaseContent';

export default async function ShowcasePage({
    params,
}: {
    params: Promise<{ lang: Locale }>;
}) {
    const { lang } = await params;
    const dict = await getDictionary(lang);

    return (
        <ShowcaseContent lang={lang} dict={dict} />
    );
}
