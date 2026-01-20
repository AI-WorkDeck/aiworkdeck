import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';
import { i18n, type Locale } from '@/i18n-config';
import { getDictionary } from '@/get-dictionary';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Workdeck',
  description: 'AI 时代文档工作者的一站式工作平台',
};

export async function generateStaticParams() {
  return i18n.locales.map((locale) => ({ lang: locale }));
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}>) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <html lang={lang} className="scroll-smooth">
      <body className={inter.className}>
        <div className="flex min-h-screen flex-col">
          <Navbar lang={lang as Locale} dict={dict} />
          <main className="flex-1">
            {children}
          </main>
          <Footer lang={lang as Locale} dict={dict} />
        </div>
      </body>
    </html>
  );
}
